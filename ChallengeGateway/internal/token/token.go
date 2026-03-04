package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// Payload is the decoded content of a challenge access token.
type Payload struct {
	Exp   int64  `json:"exp"`
	Route string `json:"route"`
}

// Verify parses and validates a token string, returning its payload on success.
func Verify(token string) (Payload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return Payload{}, fmt.Errorf("invalid token format")
	}

	secret := os.Getenv("PRIVATE_KEY")
	if strings.TrimSpace(secret) == "" {
		return Payload{}, fmt.Errorf("missing PRIVATE_KEY")
	}

	payloadB64 := parts[0]
	sigB64 := parts[1]

	sigBytes, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return Payload{}, fmt.Errorf("invalid signature encoding")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	expected := mac.Sum(nil)
	if !hmac.Equal(sigBytes, expected) {
		return Payload{}, fmt.Errorf("invalid token signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return Payload{}, fmt.Errorf("invalid payload encoding")
	}

	var payload Payload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return Payload{}, fmt.Errorf("invalid payload json")
	}

	if payload.Exp <= 0 || payload.Route == "" {
		return Payload{}, fmt.Errorf("invalid payload content")
	}

	if time.Now().Unix() > payload.Exp {
		nowStr := time.Now().Format("2006-01-02 15:04:05")
		expStr := time.Unix(payload.Exp, 0).Format("2006-01-02 15:04:05")
		return Payload{}, fmt.Errorf("token expired (Exp: %s, Server: %s)", expStr, nowStr)
	}

	return payload, nil
}

// ExpandRoute turns a bare pod/service name into a full k8s cluster-local address.
// Routes that already contain ':', '.', or '/' are returned unchanged.
func ExpandRoute(route string) string {
	if route == "" {
		return route
	}
	if strings.ContainsAny(route, ":./") {
		return route
	}
	return fmt.Sprintf("%s-svc.%s.svc.cluster.local:3333", route, route)
}

// LooksLike returns true when value has the shape of a challenge token
// (base64url chars, exactly one '.', and at least 16 characters).
func LooksLike(value string) bool {
	if value == "" || strings.Count(value, ".") != 1 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return len(value) >= 16
}
