package gateway

import (
	"bufio"
	"context"
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
	"challenge-gateway/internal/telemetry"
	"challenge-gateway/internal/token"
)

const (
	httpListenAddr      = ":8080"
	challengeCookieName = "FCTF_Auth_Token"
)

type ctxKey string

const (
	targetHostKey  ctxKey = "targetHost"
	requestInfoKey ctxKey = "requestInfo"
)

type requestInfo struct {
	TargetHost    string
	Route         string
	Payload       *token.Payload
	Event         string
	Outcome       string
	ErrorCode     string
	Authenticated bool
}

type countingReadCloser struct {
	io.ReadCloser
	bytesRead int64
}

func (cr *countingReadCloser) Read(p []byte) (int, error) {
	n, err := cr.ReadCloser.Read(p)
	cr.bytesRead += int64(n)
	return n, err
}

type statusRecorder struct {
	http.ResponseWriter
	status       int
	bytesWritten int64
	wroteHeader  bool
}

func (sr *statusRecorder) WriteHeader(code int) {
	if sr.wroteHeader {
		return
	}
	sr.status = code
	sr.wroteHeader = true
	sr.ResponseWriter.WriteHeader(code)
}

func (sr *statusRecorder) Write(p []byte) (int, error) {
	if !sr.wroteHeader {
		sr.WriteHeader(http.StatusOK)
	}
	n, err := sr.ResponseWriter.Write(p)
	sr.bytesWritten += int64(n)
	return n, err
}

// Preserve optional ResponseWriter capabilities. ReverseProxy uses these for
// streaming, SSE, and WebSocket upgrades; losing one while adding telemetry
// would change challenge behavior.
func (sr *statusRecorder) ReadFrom(r io.Reader) (int64, error) {
	if !sr.wroteHeader {
		sr.WriteHeader(http.StatusOK)
	}
	if readerFrom, ok := sr.ResponseWriter.(io.ReaderFrom); ok {
		n, err := readerFrom.ReadFrom(r)
		sr.bytesWritten += n
		return n, err
	}
	return io.Copy(struct{ io.Writer }{sr}, r)
}

func (sr *statusRecorder) Flush() {
	if !sr.wroteHeader {
		sr.WriteHeader(http.StatusOK)
	}
	if flusher, ok := sr.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (sr *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := sr.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (sr *statusRecorder) Push(target string, opts *http.PushOptions) error {
	pusher, ok := sr.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}
	return pusher.Push(target, opts)
}

func (sr *statusRecorder) Unwrap() http.ResponseWriter { return sr.ResponseWriter }

// ── HTTP gateway ─────────────────────────────────────────────────────────────
// StartHTTP initialises and starts the HTTP reverse-proxy gateway.
// It returns the *http.Server so the caller can gracefully shut it down.
func StartHTTP(cfg config.Config, limiters *limiter.Set) *http.Server {
	log.SetFlags(log.Flags() &^ (log.Ldate | log.Ltime | log.Lmicroseconds))
	tlsConfig, err := gatewayTLSConfig(cfg)
	if err != nil {
		log.Fatalf("HTTP Gateway TLS config error: %v", err)
	}

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
			if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
				info.Event = "http_upstream_error"
				info.Outcome = "upstream_error"
				info.ErrorCode = "upstream_unavailable"
			}
			// Error text may contain an upstream URL or request-derived data. The
			// structured event retains only the stable error code above.
			log.Print("HTTP upstream error")
			http.Error(w, "Cannot connect to challenge", http.StatusBadGateway)
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
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				httpGatewayHandler(w, r, proxy, limiters, cfg.HTTPMaxBodyBytes)
			}))))

	server := &http.Server{
		Addr:              httpListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	ln, err := net.Listen("tcp", httpListenAddr)
	if err != nil {
		log.Fatalf("Error starting HTTP gateway: %v", err)
	}
	ln = newGatewayListener(ln, tlsConfig)

	go func() {
		if tlsConfig != nil {
			log.Printf("[*] HTTP Gateway running on port %s (TLS enabled)...", httpListenAddr)
		} else {
			log.Printf("[*] HTTP Gateway running on port %s...", httpListenAddr)
		}
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP Gateway error: %v", err)
		}
	}()

	return server
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func httpGatewayHandler(w http.ResponseWriter, r *http.Request, proxy *httputil.ReverseProxy, limiters *limiter.Set, maxBodyBytes int64) {
	remoteAddr := r.RemoteAddr
	clientIP := ParseRemoteIP(remoteAddr)
	info, _ := r.Context().Value(requestInfoKey).(*requestInfo)

	tok, cleanedPath := extractTokenFromRequest(r)

	// Token found in URL: verify, apply rate-limit, set cookie, redirect.
	if tok != "" {
		payload, err := token.Verify(tok)
		if err != nil {
			setHTTPFailure(info, "http_auth_failed", "authentication_failed", "invalid_assertion")
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		setAuthenticatedRequestInfo(info, payload)
		if limiters != nil && limiters.HTTPRate != nil {
			if !limiters.HTTPRate.Allow(r.Context(), BuildRateLimitKeyForPayload(payload, tok, clientIP)) {
				setHTTPFailure(info, "http_rate_limited", "rate_limited", "authenticated_rate_limit")
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
		setHTTPFailure(info, "http_auth_failed", "authentication_failed", "missing_assertion")
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	payload, err := token.Verify(tok)
	if err != nil {
		setHTTPFailure(info, "http_auth_failed", "authentication_failed", "invalid_assertion")
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	setAuthenticatedRequestInfo(info, payload)

	if limiters != nil && limiters.HTTPRate != nil {
		if !limiters.HTTPRate.Allow(r.Context(), BuildRateLimitKeyForPayload(payload, tok, clientIP)) {
			setHTTPFailure(info, "http_rate_limited", "rate_limited", "authenticated_rate_limit")
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
	}

	if !enforceBodyLimit(w, r, maxBodyBytes) {
		setHTTPFailure(info, "http_request", "request_rejected", "body_too_large")
		return
	}

	host, err := token.ExpandRoute(payload.Route)
	if err != nil {
		setHTTPFailure(info, "http_auth_failed", "authentication_failed", "invalid_route")
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	if info != nil {
		info.TargetHost = host
		info.Route = payload.Route
	}

	ctx := context.WithValue(r.Context(), targetHostKey, host)
	proxy.ServeHTTP(w, r.WithContext(ctx))
}

func setAuthenticatedRequestInfo(info *requestInfo, payload token.Payload) {
	if info == nil {
		return
	}
	info.Payload = &payload
	info.Authenticated = true
	info.Event = "http_request"
	info.Outcome = "upstream_response"
}

func setHTTPFailure(info *requestInfo, event, outcome, errorCode string) {
	if info == nil {
		return
	}
	info.Event = event
	info.Outcome = outcome
	info.ErrorCode = errorCode
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
	q.Del("fctftoken")
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
	for _, key := range []string{"fctftoken"} {
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
		startedAt := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		body := &countingReadCloser{ReadCloser: r.Body}
		r.Body = body

		info := &requestInfo{}
		ctx := context.WithValue(r.Context(), requestInfoKey, info)
		next.ServeHTTP(rec, r.WithContext(ctx))

		eventName := info.Event
		if eventName == "" {
			eventName = "http_rate_limited"
			info.Outcome = "rate_limited"
			info.ErrorCode = "ip_rate_limit"
		}
		event := telemetry.New(eventName, "http")
		event.PeerIP = ParseRemoteIP(r.RemoteAddr)
		event.IPSource = "remote_addr"
		event.Method = r.Method
		event.Path = telemetry.SanitizePath(r.URL.EscapedPath())
		event.Status = &rec.status
		event.RequestBytes = body.bytesRead
		event.ResponseBytes = rec.bytesWritten
		event.DurationMS = time.Since(startedAt).Milliseconds()
		event.Outcome = info.Outcome
		event.ErrorCode = info.ErrorCode
		if info.Payload != nil {
			event.InstanceID = info.Payload.InstanceID
			event.InstanceNamespace = info.Payload.Route
			event.ContestID = info.Payload.ContestID
			event.ChallengeID = info.Payload.ChallengeID
			event.ActorUserRef = info.Payload.ActorUserRef
			event.ActorTeamID = info.Payload.ActorTeamID
			if info.Payload.InstanceID == "" {
				event.AuthStrength = "legacy"
			} else if info.Payload.ActorUserRef == "" {
				event.AuthStrength = "actor_unavailable"
			} else {
				event.AuthStrength = "credential_owner"
			}
		}
		telemetry.Emit(event)
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

// enforceBodyLimit applies the limit only after the signed access token has been
// verified. That keeps rejected unauthenticated requests from consuming an
// instance's request budget while still ensuring the upstream never receives an
// oversized body.
func enforceBodyLimit(w http.ResponseWriter, r *http.Request, maxBytes int64) bool {
	if maxBytes <= 0 {
		return true
	}
	if r.ContentLength > maxBytes {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	return true
}
