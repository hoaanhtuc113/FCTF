package main

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

const (
	httpListenAddr = ":8080"
	challengeCookieName = "challenge_token"
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
	token := ""
	cookie, err := r.Cookie(challengeCookieName)
	if err == nil {
		token = cookie.Value
	}

	if token == "" {
		token = r.URL.Query().Get("token")
	}

	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	payload, err := verifyChallengeToken(token)
	if err != nil {
		http.Error(w, fmt.Sprintf("invalid token: %v", err), http.StatusUnauthorized)
		return
	}

	if cookie == nil {
		maxAge := int(payload.Exp - time.Now().Unix())
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

		cleanURL := *r.URL
		query := cleanURL.Query()
		query.Del("token")
		cleanURL.RawQuery = query.Encode()
		http.Redirect(w, r, cleanURL.String(), http.StatusFound)
		return
	}

	target := &url.URL{Scheme: "http", Host: payload.Route}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "upstream error", http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
}
