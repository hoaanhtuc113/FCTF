package main

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

const (
	httpListenAddr = ":8080"
	challengeCookieName = "FCTF_Auth_Token"
)

func startHTTPGateway() {
	http.HandleFunc("/", httpGatewayHandler)

	go func() {
		log.Printf("[*] HTTP Gateway running on port %s...", httpListenAddr)
		if err := http.ListenAndServe(httpListenAddr, nil); err != nil {
			log.Fatalf("HTTP Gateway error: %v", err)
		}
	}()
}

func httpGatewayHandler(w http.ResponseWriter, r *http.Request) {
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
	
	
	target := &url.URL{Scheme: "http", Host: payload.Route}
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		req.Host = target.Host
		originalDirector(req)
		cleanProxyCookies(req)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "upstream error", http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
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

func looksLikeToken(value string) bool {
	if value == "" {
		return false
	}
	if strings.Count(value, ".") != 1 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return len(value) >= 16
}
