package gateway

import (
	"context"
	"errors"
	"net/http"
	"time"

	"challenge-gateway/internal/limiter"
	"challenge-gateway/internal/token"
)

func checkAccess(ctx context.Context, limiters *limiter.Set, tok string, p token.Payload) error {
	if limiters == nil || limiters.Access == nil {
		return token.ErrAccessUnavailable
	}
	return limiters.Access.Check(ctx, tok, p)
}

func accessError(w http.ResponseWriter, err error) {
	setNoStoreHeaders(w)
	if errors.Is(err, token.ErrRevoked) {
		http.SetCookie(w, &http.Cookie{Name: challengeCookieName, Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
		http.Error(w, "Challenge session has ended", http.StatusGone)
	} else {
		http.Error(w, "Challenge authorization is unavailable", http.StatusServiceUnavailable)
	}
}

// Close long-lived HTTP/TCP streams after revocation, including Redis failures.
// Fast HTTP responses finish before the first tick, with only the initial check.
func watchAccess(ctx context.Context, limiters *limiter.Set, tok string, p token.Payload, closeSession func()) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if checkAccess(ctx, limiters, tok, p) != nil {
				closeSession()
				return
			}
		}
	}
}
