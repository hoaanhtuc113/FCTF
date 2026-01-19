package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

const (
	httpListenAddr    = ":8080"
	challengeCookieName = "FCTF_Auth_Token"
)

var httpRateLimiter rateLimiter

type ctxKey string

const targetHostKey ctxKey = "targetHost"

type requestInfo struct {
	TargetHost string
}

const requestInfoKey ctxKey = "requestInfo"

func startHTTPGateway() *http.Server {
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
			value := req.Context().Value(targetHostKey)
			targetHost, _ := value.(string)
			req.URL.Scheme = "http"
			req.URL.Host = targetHost
			req.Host = targetHost
			cleanProxyCookies(req)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("HTTP upstream error: %v", err)
			http.Error(w, "upstream error", http.StatusBadGateway)
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.Handle("/", loggingMiddleware(rateLimitMiddleware(bodySizeLimitMiddleware(cfg.HTTPMaxBodyBytes, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		httpGatewayHandler(w, r, proxy)
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

func httpGatewayHandler(w http.ResponseWriter, r *http.Request, proxy *httputil.ReverseProxy) {
	token, cleanedPath := extractTokenFromRequest(r)
	// If token found in URL
	if token != "" {
        payload, err := verifyChallengeToken(token)
        if err != nil {
            http.Error(w, fmt.Sprintf("invalid token: %v", err), http.StatusUnauthorized)
            return
        }
        setTokenCookieAndRedirect(w, r, token, payload.Exp, cleanedPath)
        return
    }

	// If no token in URL, check cookie
	cookie, err := r.Cookie(challengeCookieName)
	if token == "" && err == nil {
		token = cookie.Value
	}

	//If still no token, reject
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	// Verify token
	payload, err := verifyChallengeToken(token)
	if err != nil {
		http.Error(w, fmt.Sprintf("invalid token: %v", err), http.StatusUnauthorized)
		return
	}

	// Store target host in requestInfo for logging
	if info, ok := r.Context().Value(requestInfoKey).(*requestInfo); ok {
		info.TargetHost = payload.Route
	}

	ctx := context.WithValue(r.Context(), targetHostKey, payload.Route)
	proxy.ServeHTTP(w, r.WithContext(ctx))
}

func cleanProxyCookies(req *http.Request) {
	allCookies := req.Cookies()
	req.Header.Del("Cookie")
	for _, cookie := range allCookies {
		if cookie.Name == challengeCookieName {
			continue
		}
		req.AddCookie(cookie)
	}
}

func setTokenCookieAndRedirect(w http.ResponseWriter, r *http.Request, token string, exp int64, cleanedPath string) {
	maxAge := int(exp - time.Now().Unix())
	if maxAge < 1 {
		maxAge = 1
	}
	newCookie := &http.Cookie{
		Name:     challengeCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
		Secure:   r.TLS != nil,
	}
	http.SetCookie(w, newCookie)
	redirectURL := buildCleanRedirectURL(r.URL, cleanedPath)
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func buildCleanRedirectURL(originalURL *url.URL, cleanedPath string) string {
	cleanURL := *originalURL
	query := cleanURL.Query()

	query.Del("token")
	query.Del("t")
	query.Del("access_token")
	cleanURL.RawQuery = query.Encode()
	if cleanedPath != "" {
		cleanURL.Path = cleanedPath
	}
	cleanURL.Host = ""
	cleanURL.Scheme = ""

	return cleanURL.String()
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		// Create requestInfo to capture target host
		info := &requestInfo{}
		ctx := context.WithValue(r.Context(), requestInfoKey, info)

		next.ServeHTTP(recorder, r.WithContext(ctx))

		targetHost := info.TargetHost
		if targetHost == "" {
			targetHost = "-"
		}
		log.Printf("HTTP %s %s %d %s -> %s", r.Method, r.URL.Path, recorder.status, time.Since(start), targetHost)
	})
}

func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if httpRateLimiter == nil {
			next.ServeHTTP(w, r)
			return
		}
		ip := parseRemoteIP(r.RemoteAddr)
		token, _ := extractTokenFromRequest(r)
		if token == "" {
			if cookie, err := r.Cookie(challengeCookieName); err == nil && looksLikeToken(cookie.Value) {
				token = cookie.Value
			}
		}
		key := buildRateLimitKey(token, ip)
		if !httpRateLimiter.Allow(r.Context(), key) {
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
		if r.ContentLength > maxBytes {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
		next.ServeHTTP(w, r)
	})
}

func extractTokenFromRequest(r *http.Request) (string, string) {
	query := r.URL.Query()
	for _, key := range []string{"token", "t", "access_token"} {
		if val := query.Get(key); val != "" {
			return val, r.URL.Path
		}
	}

	for _, values := range query {
		for _, v := range values {
			if looksLikeToken(v) {
				return v, r.URL.Path
			}
		}
	}

	segments := strings.Split(r.URL.Path, "/")
	cleanSegments := make([]string, 0, len(segments))
	var token string
	for _, seg := range segments {
		if token == "" && looksLikeToken(seg) {
			token = seg
			continue
		}
		cleanSegments = append(cleanSegments, seg)
	}
	cleanPath := strings.Join(cleanSegments, "/")
	if cleanPath == "" {
		cleanPath = "/"
	}

	return token, cleanPath
}
