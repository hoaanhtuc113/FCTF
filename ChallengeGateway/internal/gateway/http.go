package gateway

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"challenge-gateway/internal/config"
	"challenge-gateway/internal/limiter"
	"challenge-gateway/internal/token"
)

const (
	httpListenAddr        = ":8080"
	challengeCookieName   = "FCTF_Auth_Token"
	maxLoggedPostBodyBytes = 2048
)

type ctxKey string

const (
	targetHostKey  ctxKey = "targetHost"
	requestInfoKey ctxKey = "requestInfo"
)

type requestInfo struct {
	TargetHost string
	Route      string
}

type teeReadCloser struct {
	io.Reader
	io.Closer
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

// StartHTTP initialises and starts the HTTP reverse-proxy gateway.
// It returns the *http.Server so the caller can gracefully shut it down.
func StartHTTP(cfg config.Config, limiters *limiter.Set) *http.Server {
	log.SetFlags(log.Flags() &^ (log.Ldate | log.Ltime | log.Lmicroseconds))

	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   50,
		IdleConnTimeout:       90 * time.Second,
	}

	proxy := &httputil.ReverseProxy{
		Transport: transport,
		Director: func(req *http.Request) {
			targetHost, _ := req.Context().Value(targetHostKey).(string)
			req.URL.Scheme = "http"
			req.URL.Host = targetHost
			req.Host = targetHost
			cleanProxyCookies(req)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("HTTP upstream error: %v", err)
			http.Error(w, "upstream error", http.StatusBadGateway)
		},
		ModifyResponse: func(resp *http.Response) error {
			enforceNoStoreForHTML(resp)
			return nil
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/healthcheck", healthHandler)
	mux.Handle("/", loggingMiddleware(
		rateLimitMiddleware(limiters,
			bodySizeLimitMiddleware(cfg.HTTPMaxBodyBytes,
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					httpGatewayHandler(w, r, proxy, limiters)
				})))))

	server := &http.Server{
		Addr:              httpListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Printf("[*] HTTP Gateway running on port %s...", httpListenAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP Gateway error: %v", err)
		}
	}()

	return server
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func httpGatewayHandler(w http.ResponseWriter, r *http.Request, proxy *httputil.ReverseProxy, limiters *limiter.Set) {
	remoteAddr := r.RemoteAddr
	clientIP := ParseRemoteIP(remoteAddr)

	tok, cleanedPath := extractTokenFromRequest(r)

	// Token found in URL: verify, apply rate-limit, set cookie, redirect.
	if tok != "" {
		payload, err := token.Verify(tok)
		if err != nil {
			log.Printf("[-] HTTP auth failed from %s: %v", remoteAddr, err)
			http.Error(w, fmt.Sprintf("invalid token: %v", err), http.StatusUnauthorized)
			return
		}
		if limiters != nil && limiters.HTTPRate != nil {
			if !limiters.HTTPRate.Allow(r.Context(), BuildRateLimitKey(tok, clientIP)) {
				http.Error(w, "too many requests", http.StatusTooManyRequests)
				return
			}
		}
		resetAllCookies(w, r)
		setTokenCookie(w, r, tok, payload.Exp)
		setNoStoreHeaders(w)
		http.Redirect(w, r, buildCleanRedirectURL(r.URL, cleanedPath), http.StatusFound)
		return
	}

	// No token in URL – check cookie.
	if cookie, err := r.Cookie(challengeCookieName); err == nil {
		tok = cookie.Value
	}

	if tok == "" {
		log.Printf("[-] HTTP auth failed from %s: missing token", remoteAddr)
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	payload, err := token.Verify(tok)
	if err != nil {
		log.Printf("[-] HTTP auth failed from %s: %v", remoteAddr, err)
		http.Error(w, fmt.Sprintf("invalid token: %v", err), http.StatusUnauthorized)
		return
	}

	if limiters != nil && limiters.HTTPRate != nil {
		if !limiters.HTTPRate.Allow(r.Context(), BuildRateLimitKey(tok, clientIP)) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
	}

	host := token.ExpandRoute(payload.Route)
	if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
		info.TargetHost = host
		info.Route = payload.Route
	}

	ctx := context.WithValue(r.Context(), targetHostKey, host)
	proxy.ServeHTTP(w, r.WithContext(ctx))
}

// ── cookie / redirect helpers ─────────────────────────────────────────────────

func cleanProxyCookies(req *http.Request) {
	all := req.Cookies()
	req.Header.Del("Cookie")
	for _, c := range all {
		if c.Name != challengeCookieName {
			req.AddCookie(c)
		}
	}
}

func setTokenCookie(w http.ResponseWriter, r *http.Request, tok string, exp int64) {
	maxAge := int(exp - time.Now().Unix())
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(w, &http.Cookie{
		Name:     challengeCookieName,
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
		Secure:   r.TLS != nil,
	})
}

func resetAllCookies(w http.ResponseWriter, r *http.Request) {
	secure := r.TLS != nil
	seen := map[string]struct{}{}
	for _, c := range r.Cookies() {
		if c == nil || c.Name == "" {
			continue
		}
		if _, ok := seen[c.Name]; ok {
			continue
		}
		seen[c.Name] = struct{}{}
		http.SetCookie(w, &http.Cookie{
			Name:     c.Name,
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   secure,
			MaxAge:   -1,
			Expires:  time.Unix(0, 0),
		})
	}
}

func setNoStoreHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
}

func enforceNoStoreForHTML(resp *http.Response) {
	if resp == nil {
		return
	}
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if !strings.Contains(ct, "text/html") {
		return
	}
	resp.Header.Set("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0")
	resp.Header.Set("Pragma", "no-cache")
	resp.Header.Set("Expires", "0")
	resp.Header.Del("ETag")
	resp.Header.Del("Last-Modified")
}

func buildCleanRedirectURL(originalURL *url.URL, cleanedPath string) string {
	u := *originalURL
	q := u.Query()
	q.Del("token")
	q.Del("t")
	q.Del("access_token")
	u.RawQuery = q.Encode()
	if cleanedPath != "" {
		u.Path = cleanedPath
	}
	u.Host = ""
	u.Scheme = ""
	return u.String()
}

// ── token extraction from request ────────────────────────────────────────────

func extractTokenFromRequest(r *http.Request) (string, string) {
	query := r.URL.Query()

	// Only allow explicit query parameters.
	for _, key := range []string{"token", "t"} {
		if val := query.Get(key); val != "" {
			return val, r.URL.Path
		}
	}

	cleanPath := r.URL.Path
	if cleanPath == "" {
		cleanPath = "/"
	}
	return "", cleanPath
}

// ── middleware ────────────────────────────────────────────────────────────────

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		var postBodyBuf bytes.Buffer
		capturePost := r.Method == http.MethodPost && r.Body != nil
		if capturePost {
			r.Body = &teeReadCloser{
				Reader: io.TeeReader(r.Body, &postBodyBuf),
				Closer: r.Body,
			}
		}

		info := &requestInfo{}
		ctx := context.WithValue(r.Context(), requestInfoKey, info)
		next.ServeHTTP(rec, r.WithContext(ctx))

		targetHost := info.TargetHost
		if targetHost == "" {
			targetHost = "-"
		}
		nsName := info.Route

		// Suppress noisy token-redirect log lines.
		if r.Method == http.MethodGet && rec.status == http.StatusFound && targetHost == "-" {
			if tok, _ := extractTokenFromRequest(r); tok != "" {
				return
			}
		}

		postSuffix := ""
		if capturePost {
			body := postBodyBuf.String()
			if len(body) > maxLoggedPostBodyBytes {
				body = body[:maxLoggedPostBodyBytes] + "... (truncated)"
			}
			postSuffix = fmt.Sprintf(" body=%q", body)
		}

		if targetHost != "-" {
			if teamID, challengeID, ok := ParseTeamChallengeFromRoute(targetHost); ok {
					log.Printf("HTTP %s %s %d team=\"%d\" challenge=\"%d\" ns=\"%s\" method=\"%s\" status=\"%d\" -> %s%s",
						r.Method, r.URL.Path, rec.status, teamID, challengeID, nsName, r.Method, rec.status, targetHost, postSuffix)
				return
			}
		}
		if nsName != "" {
			log.Printf("HTTP %s %s %d ns=\"%s\" method=\"%s\" status=\"%d\" -> %s%s", r.Method, r.URL.Path, rec.status, nsName, r.Method, rec.status, targetHost, postSuffix)
		} else {
			log.Printf("HTTP %s %s %d method=\"%s\" status=\"%d\" -> %s%s", r.Method, r.URL.Path, rec.status, r.Method, rec.status, targetHost, postSuffix)
		}
	})
}

func rateLimitMiddleware(limiters *limiter.Set, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if limiters == nil || limiters.HTTPIPRate == nil {
			next.ServeHTTP(w, r)
			return
		}
		ip := ParseRemoteIP(r.RemoteAddr)
		if !limiters.HTTPIPRate.Allow(r.Context(), ip) {
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func bodySizeLimitMiddleware(maxBytes int64, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if maxBytes <= 0 {
			next.ServeHTTP(w, r)
			return
		}
		if r.ContentLength > 0 && r.ContentLength > maxBytes {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		if r.ContentLength < 0 {
			log.Printf("[!] Chunked/unknown transfer from %s – enforcing %d byte limit during read",
				r.RemoteAddr, maxBytes)
		}
		next.ServeHTTP(w, r)
	})
}
