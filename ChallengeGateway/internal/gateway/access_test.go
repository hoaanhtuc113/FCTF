package gateway

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"challenge-gateway/internal/limiter"
	"challenge-gateway/internal/token"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func signedToken(t *testing.T, p token.Payload) string {
	t.Helper()
	t.Setenv("PRIVATE_KEY", "test-key")
	data, _ := json.Marshal(p)
	encoded := base64.RawURLEncoding.EncodeToString(data)
	mac := hmac.New(sha256.New, []byte("test-key"))
	mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestHTTPStopsBeforeProxyAndRejectsURLToken(t *testing.T) {
	var calls atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Server", "InternalServer/1.2.3")
		w.Header().Set("X-Powered-By", "InternalRuntime/4.5.6")
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("challenge"))
	}))
	defer upstream.Close()
	route := upstream.Listener.Addr().String()
	p := token.Payload{Route: route, DeploymentKey: "deploy_challenge_10_1", Exp: time.Now().Unix() + 60}
	tok := signedToken(t, p)
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	set := &limiter.Set{Access: token.NewAccessChecker(client)}
	address, _ := url.Parse(upstream.URL)
	proxy := httputil.NewSingleHostReverseProxy(address)
	proxy.ModifyResponse = secureUpstreamResponse
	raw, _ := json.Marshal(map[string]any{"status": "Running", "ready": true, "_namespace": route, "challenge_url": tok})
	server.Set(p.DeploymentKey, string(raw))
	request := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", path, nil)
		req.AddCookie(&http.Cookie{Name: challengeCookieName, Value: tok})
		response := httptest.NewRecorder()
		httpGatewayHandler(response, req, proxy, set)
		return response
	}
	if response := request("/"); response.Code != 200 || response.Header().Get("Server") != "" || response.Header().Get("X-Powered-By") != "" || response.Header().Get("Cache-Control") == "" {
		t.Fatalf("active=%d headers=%v", response.Code, response.Header())
	}
	server.Set("fctf:gateway:revoked:"+route, "1")
	if response := request("/"); response.Code != 410 {
		t.Fatalf("revoked=%d", response.Code)
	}
	if response := request("/?fctftoken=" + tok); response.Code != 410 {
		t.Fatalf("URL token=%d", response.Code)
	}
	if calls.Load() != 1 {
		t.Fatalf("revoked requests reached upstream: %d", calls.Load())
	}
	server.Close()
	if response := request("/"); response.Code != 503 {
		t.Fatalf("Redis unavailable=%d", response.Code)
	}
}

func TestEstablishedTCPSessionIsClosedOnRevocation(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		io.Copy(conn, conn)
	}()
	p := token.Payload{Route: listener.Addr().String(), DeploymentKey: "deploy_challenge_10_1", Exp: time.Now().Unix() + 60}
	tok := signedToken(t, p)
	raw, _ := json.Marshal(map[string]any{"status": "Running", "ready": true, "_namespace": p.Route, "challenge_url": tok})
	server.Set(p.DeploymentKey, string(raw))
	user, gateway := net.Pipe()
	defer user.Close()
	defer gateway.Close()
	user.SetDeadline(time.Now().Add(5 * time.Second))
	done := make(chan struct{})
	go func() {
		defer close(done)
		handleTCPConnection(gateway, time.Second, &limiter.Set{Access: token.NewAccessChecker(client)}, &sync.Pool{New: func() any { return make([]byte, 1024) }})
	}()
	reader := bufio.NewReader(user)
	if _, err := reader.ReadString(':'); err != nil {
		t.Fatal(err)
	}
	if _, err := fmt.Fprintln(user, tok); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	if _, err := fmt.Fprintln(user, "ping"); err != nil {
		t.Fatal(err)
	}
	if line, err := reader.ReadString('\n'); err != nil || line != "ping\n" {
		t.Fatalf("proxy failed: %q %v", line, err)
	}
	server.Set("fctf:gateway:revoked:"+p.Route, "1")
	if _, err := reader.ReadByte(); err != io.EOF {
		t.Fatalf("revoked stream was not closed: %v", err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("TCP handler remained open")
	}
}

func TestEstablishedHTTPStreamIsCancelledOnRevocation(t *testing.T) {
	upstreamDone := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintln(w, "connected")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(upstreamDone)
	}))
	defer upstream.Close()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	p := token.Payload{Route: upstream.Listener.Addr().String(), DeploymentKey: "deploy_challenge_10_1", Exp: time.Now().Unix() + 60}
	tok := signedToken(t, p)
	raw, _ := json.Marshal(map[string]any{"status": "Running", "ready": true, "_namespace": p.Route, "challenge_url": tok})
	server.Set(p.DeploymentKey, string(raw))
	address, _ := url.Parse(upstream.URL)
	proxy := httputil.NewSingleHostReverseProxy(address)
	set := &limiter.Set{Access: token.NewAccessChecker(client)}
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { httpGatewayHandler(w, r, proxy, set) }))
	defer gateway.Close()
	req, _ := http.NewRequest("GET", gateway.URL, nil)
	req.AddCookie(&http.Cookie{Name: challengeCookieName, Value: tok})
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if line, err := bufio.NewReader(response.Body).ReadString('\n'); err != nil || line != "connected\n" {
		t.Fatalf("stream did not start: %q %v", line, err)
	}
	server.Set("fctf:gateway:revoked:"+p.Route, "1")
	select {
	case <-upstreamDone:
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP upstream request remained open")
	}
}
