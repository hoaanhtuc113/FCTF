package gateway

import (
	"bufio"
	"context"
	"errors"
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
	"challenge-gateway/internal/requestlog"
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
	TargetHost     string
	Route          string
	Payload        *token.Payload
	Authenticated  bool
	Event          string
	Outcome        string
	ErrorCode      string
	CaptureProfile requestlog.CaptureProfile
	PrepareCapture func()
	DisableCapture func()
}

type statusRecorder struct {
	http.ResponseWriter
	status       int
	bytesWritten int64
	wroteHeader  bool
	capture      *requestlog.Buffer
}

func (sr *statusRecorder) WriteHeader(code int) {
	if sr.wroteHeader {
		return
	}
	sr.wroteHeader = true
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

func (sr *statusRecorder) Write(p []byte) (int, error) {
	if !sr.wroteHeader {
		sr.WriteHeader(http.StatusOK)
	}
	n, err := sr.ResponseWriter.Write(p)
	sr.bytesWritten += int64(n)
	if sr.capture != nil && n > 0 {
		_, _ = sr.capture.Write(p[:n])
	}
	return n, err
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

func (sr *statusRecorder) Unwrap() http.ResponseWriter { return sr.ResponseWriter }

type countingReadCloser struct {
	io.ReadCloser
	bytesRead int64
	capture   *requestlog.Buffer
}

func (r *countingReadCloser) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if n > 0 {
		r.bytesRead += int64(n)
		if r.capture != nil {
			_, _ = r.capture.Write(p[:n])
		}
	}
	return n, err
}

// ── HTTP gateway ─────────────────────────────────────────────────────────────
// StartHTTP initialises and starts the HTTP reverse-proxy gateway.
// The returned close function drains the bounded request-log capture queue.
func StartHTTP(cfg config.Config, limiters *limiter.Set) (*http.Server, func(context.Context) error) {
	log.SetFlags(log.Flags() &^ (log.Ldate | log.Ltime | log.Lmicroseconds))
	var objectStore requestlog.ObjectStore
	if cfg.RequestLogS3Endpoint != "" || cfg.RequestLogS3Bucket != "" {
		var err error
		objectStore, err = requestlog.NewS3ObjectStore(requestlog.S3Config{
			Endpoint: cfg.RequestLogS3Endpoint, Bucket: cfg.RequestLogS3Bucket,
			Region: cfg.RequestLogS3Region, AccessKeyID: cfg.RequestLogS3AccessKey,
			SecretAccessKey: cfg.RequestLogS3SecretKey, SessionToken: cfg.RequestLogS3SessionToken,
			PathStyle: cfg.RequestLogS3PathStyle, SSE: cfg.RequestLogS3SSE, KMSKeyID: cfg.RequestLogS3KMSKeyID,
		})
		if err != nil {
			log.Printf("[!] Request-log S3 configuration refused; content capture is disabled: %v", err)
			objectStore = nil
		}
	} else if !strings.EqualFold(cfg.AppEnv, "production") && !strings.EqualFold(cfg.AppEnv, "prod") && cfg.RequestLogObjectDir != "" {
		objectStore = requestlog.FileObjectStore{Root: cfg.RequestLogObjectDir}
	}
	var quota requestlog.Quota
	if limiters != nil {
		quota = limiters.CaptureQuota
	}
	requestLogManager := requestlog.NewManager(requestlog.ManagerConfig{
		Store: objectStore, QueueSize: cfg.RequestLogQueueSize, RetryAttempts: cfg.RequestLogRetryAttempts,
		WorkerCount: cfg.RequestLogWorkerCount, SpoolDir: cfg.RequestLogSpoolDir,
		SpoolMaxBytes: cfg.RequestLogSpoolMaxBytes, Quota: quota,
	})
	contentCaptureEnabled := cfg.RequestLogCaptureEnabled && requestLogManager.Enabled()
	if cfg.RequestLogCaptureEnabled && !requestLogManager.Enabled() {
		log.Printf("[!] Request-log content capture requested without a configured object store/spool; content capture is disabled")
	}
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
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
					info.Event, info.Outcome, info.ErrorCode = "http_request", "rejected", "request_body_too_large"
				}
				http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
				return
			}
			if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
				info.Event, info.Outcome, info.ErrorCode = "http_upstream_error", "upstream_error", "upstream_unavailable"
			}
			http.Error(w, "Cannot connect to challenge", http.StatusBadGateway)
		},
		ModifyResponse: func(resp *http.Response) error {
			enforceNoStoreForHTML(resp)
			if resp != nil && resp.Request != nil {
				if info, ok := resp.Request.Context().Value(requestInfoKey).(*requestInfo); ok &&
					(resp.StatusCode == http.StatusSwitchingProtocols || strings.HasPrefix(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream")) &&
					info.DisableCapture != nil {
					info.DisableCapture()
				}
			}
			return nil
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthHandler)
	mux.HandleFunc("/healthcheck", healthHandler)
	mux.HandleFunc("/metrics", telemetry.MetricsHandler)
	mux.Handle("/", loggingMiddlewareWithCapture(requestLogManager, contentCaptureEnabled, cfg.RequestLogHeaderCapBytes, cfg.RequestLogBodyCapBytes,
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

	return server, requestLogManager.Close
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
			setHTTPFailure(r, "http_auth_failed", "authentication_failed", authErrorCode(err))
			http.Error(w, fmt.Sprintf("invalid token: %v", err), http.StatusUnauthorized)
			return
		}
		setHTTPPayload(r, payload, false)
		if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
			info.Outcome = "token_redirect"
		}
		if limiters != nil && limiters.HTTPRate != nil {
			if !limiters.HTTPRate.Allow(r.Context(), BuildRateLimitKey(tok, clientIP)) {
				setHTTPFailure(r, "http_rate_limited", "rate_limited", "authenticated_rate_limit")
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
		setHTTPFailure(r, "http_auth_failed", "authentication_failed", "missing_assertion")
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	payload, err := token.Verify(tok)
	if err != nil {
		setHTTPFailure(r, "http_auth_failed", "authentication_failed", authErrorCode(err))
		http.Error(w, fmt.Sprintf("invalid token: %v", err), http.StatusUnauthorized)
		return
	}
	setHTTPPayload(r, payload, true)

	if limiters != nil && limiters.HTTPRate != nil {
		if !limiters.HTTPRate.Allow(r.Context(), BuildRateLimitKey(tok, clientIP)) {
			setHTTPFailure(r, "http_rate_limited", "rate_limited", "authenticated_rate_limit")
			http.Error(w, "too many requests", http.StatusTooManyRequests)
			return
		}
	}
	if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok && info.Authenticated &&
		info.CaptureProfile == requestlog.ProfileBoundedContent && requestlog.ValidNamespace(info.Route) && info.PrepareCapture != nil {
		info.PrepareCapture()
	}

	host := token.ExpandRoute(payload.Route)
	if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
		info.TargetHost = host
		info.Route = payload.Route
	}

	ctx := context.WithValue(r.Context(), targetHostKey, host)
	proxy.ServeHTTP(w, r.WithContext(ctx))
}

func setHTTPPayload(r *http.Request, payload token.Payload, authenticated bool) {
	if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
		info.Payload = &payload
		info.Route = payload.Route
		info.Authenticated = authenticated
		info.CaptureProfile = requestlog.NormalizeProfile(payload.CaptureProfile)
		info.Event = "http_request"
		info.Outcome = "upstream_response"
		if payload.ChallengeID == nil || payload.ActorTeamID == nil {
			teamID, challengeID, parsed := ParseTeamChallengeFromRoute(payload.Route)
			if parsed {
				if payload.ChallengeID == nil {
					payload.ChallengeID = &challengeID
				}
				if teamID > 0 && payload.ActorTeamID == nil {
					payload.ActorTeamID = &teamID
				}
				info.Payload = &payload
			}
		}
	}
}

func setHTTPFailure(r *http.Request, event, outcome, errorCode string) {
	if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
		info.Event, info.Outcome, info.ErrorCode = event, outcome, errorCode
	}
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

func loggingMiddlewareWithCapture(manager *requestlog.Manager, captureEnabled bool, headerCap, bodyCap int, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		event := telemetry.New("http_request", "http")
		var requestCapture, responseCapture *requestlog.Buffer
		var requestHeaders http.Header
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		body := &countingReadCloser{ReadCloser: r.Body}
		r.Body = body
		info := &requestInfo{Event: "http_request", CaptureProfile: requestlog.ProfileMetadata}
		info.PrepareCapture = func() {
			if !captureEnabled || requestCapture != nil {
				return
			}
			requestCapture = requestlog.NewBuffer(bodyCap)
			responseCapture = requestlog.NewBuffer(bodyCap)
			requestHeaders = r.Header.Clone()
			body.capture = requestCapture
			rec.capture = responseCapture
		}
		info.DisableCapture = func() {
			body.capture = nil
			rec.capture = nil
			requestCapture = nil
			responseCapture = nil
			requestHeaders = nil
		}
		ctx := context.WithValue(r.Context(), requestInfoKey, info)
		next.ServeHTTP(rec, r.WithContext(ctx))
		if !rec.wroteHeader {
			rec.status = http.StatusOK
		}
		if rec.status == http.StatusSwitchingProtocols || r.Header.Get("Upgrade") != "" || strings.HasPrefix(strings.ToLower(rec.Header().Get("Content-Type")), "text/event-stream") {
			if info.Authenticated && info.CaptureProfile == requestlog.ProfileBoundedContent {
				event.CaptureSubmission = string(requestlog.SubmissionSkippedByPolicy)
			}
		}
		if info.Event != "" {
			event.Event = info.Event
		}
		event.PeerIP = ParseRemoteIP(r.RemoteAddr)
		event.IPSource = "remote_addr"
		event.Method = r.Method
		event.Path = telemetry.SanitizePath(r.URL.EscapedPath())
		event.Status = intPtr(rec.status)
		event.RequestBytes = body.bytesRead
		event.ResponseBytes = rec.bytesWritten
		event.DurationMS = time.Since(startedAt).Milliseconds()
		event.Outcome = info.Outcome
		event.ErrorCode = info.ErrorCode
		event.ContentSchemaVersion = 1
		event.CaptureProfile = string(info.CaptureProfile)
		if info.Payload != nil && requestlog.ValidNamespace(info.Payload.Route) {
			event.InstanceNamespace = info.Payload.Route
			event.ChallengeID = info.Payload.ChallengeID
			event.ActorTeamID = info.Payload.ActorTeamID
			event.AuthStrength = "signed_route"
			if info.Payload.ChallengeID == nil {
				event.AuthStrength = "legacy"
			}
		}
		if info.Authenticated && info.CaptureProfile == requestlog.ProfileMetadata {
			event.CaptureSubmission = string(requestlog.SubmissionNotRequested)
		} else if info.Authenticated && info.CaptureProfile == requestlog.ProfileBoundedContent && info.Event == "http_rate_limited" {
			event.CaptureSubmission = string(requestlog.SubmissionSkippedByPolicy)
		} else if info.Authenticated && info.CaptureProfile == requestlog.ProfileBoundedContent && (!captureEnabled || manager == nil || requestCapture == nil || responseCapture == nil) {
			event.CaptureSubmission = string(requestlog.SubmissionSkippedByPolicy)
		} else if captureEnabled && info.Authenticated && info.Event != "http_rate_limited" && info.CaptureProfile == requestlog.ProfileBoundedContent && requestlog.ValidNamespace(info.Route) && event.CaptureSubmission == "" {
			occurredAt, parseErr := time.Parse(time.RFC3339Nano, event.OccurredAt)
			if parseErr != nil {
				occurredAt = startedAt.UTC()
			}
			tx := requestlog.Transaction{
				ContentSchemaVersion: 1, EventID: event.EventID, InstanceNamespace: info.Route,
				ChallengeID: event.ChallengeID, ActorTeamID: event.ActorTeamID,
				OccurredAt: occurredAt, CapturedAt: time.Now().UTC(),
				CaptureProfile: requestlog.ProfileBoundedContent, Method: r.Method,
				Path: event.Path, Status: rec.status, DurationMS: event.DurationMS,
				Outcome: event.Outcome, ErrorCode: event.ErrorCode, RemoteIP: event.PeerIP,
				Request:  requestCapture.SanitizedPart(r.Header.Get("Content-Type")),
				Response: responseCapture.SanitizedPart(rec.Header().Get("Content-Type")),
			}
			tx.Request.Headers = requestlog.SanitizeHeadersLimited(requestHeaders, headerCap)
			tx.Request.QueryParams = requestlog.ParametersLimited(r.URL.Query(), headerCap)
			tx.Request.ContentType = r.Header.Get("Content-Type")
			tx.Request.Encoding = r.Header.Get("Content-Encoding")
			if strings.HasPrefix(strings.ToLower(tx.Request.ContentType), "application/x-www-form-urlencoded") {
				if form, err := url.ParseQuery(string(requestCapture.Bytes())); err == nil {
					tx.Request.FormParams = requestlog.ParametersLimited(form, headerCap)
				}
			}
			tx.Response.Headers = requestlog.SanitizeHeadersLimited(rec.Header(), headerCap)
			tx.Response.ContentType = rec.Header().Get("Content-Type")
			tx.Response.Encoding = rec.Header().Get("Content-Encoding")
			submission := manager.Enqueue(tx)
			telemetry.ObserveCaptureSubmission(string(submission))
			event.CaptureSubmission = string(submission)
		} else if info.Authenticated && info.Event != "http_rate_limited" && info.CaptureProfile == requestlog.ProfileBoundedContent && !requestlog.ValidNamespace(info.Route) {
			event.CaptureSubmission = string(requestlog.SubmissionSkippedByPolicy)
		}
		telemetry.Emit(event)
	})
}

func intPtr(value int) *int { return &value }

func rateLimitMiddleware(limiters *limiter.Set, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if limiters == nil || limiters.HTTPIPRate == nil {
			next.ServeHTTP(w, r)
			return
		}
		ip := ParseRemoteIP(r.RemoteAddr)
		if !limiters.HTTPIPRate.Allow(r.Context(), ip) {
			if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
				info.Event, info.Outcome, info.ErrorCode = "http_rate_limited", "rate_limited", "ip_rate_limit"
			}
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
			setHTTPFailure(r, "http_request", "rejected", "request_body_too_large")
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		next.ServeHTTP(w, r)
	})
}
