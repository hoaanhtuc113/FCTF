package main

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

type challengeTokenPayload struct {
	Exp   int64  `json:"exp"`
	Route string `json:"route"`
}

func verifyChallengeToken(token string) (challengeTokenPayload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return challengeTokenPayload{}, fmt.Errorf("invalid token format")
	}

	secret := os.Getenv("PRIVATE_KEY")
	if strings.TrimSpace(secret) == "" {
		return challengeTokenPayload{}, fmt.Errorf("missing PRIVATE_KEY")
	}

	payloadB64 := parts[0]
	sigB64 := parts[1]

	sigBytes, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return challengeTokenPayload{}, fmt.Errorf("invalid signature encoding")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	expected := mac.Sum(nil)
	if !hmac.Equal(sigBytes, expected) {
		return challengeTokenPayload{}, fmt.Errorf("invalid token signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return challengeTokenPayload{}, fmt.Errorf("invalid payload encoding")
	}

	var payload challengeTokenPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return challengeTokenPayload{}, fmt.Errorf("invalid payload json")
	}

	if payload.Exp <= 0 || payload.Route == "" {
		return challengeTokenPayload{}, fmt.Errorf("invalid payload content")
	}

if time.Now().Unix() > payload.Exp {
    nowStr := time.Now().Format("2006-01-02 15:04:05")
    expStr := time.Unix(payload.Exp, 0).Format("2006-01-02 15:04:05")
    
    return challengeTokenPayload{}, fmt.Errorf("token expired (Exp: %s, Server: %s)", expStr, nowStr)
}

	return payload, nil
}

// expandRoute builds the full k8s service host when the route is provided
// as a simple pod name (e.g., "podName"). If the route already contains
// a dot, colon or slash it is returned unchanged.
func expandRoute(route string) string {
	if route == "" {
		return route
	}
	if strings.ContainsAny(route, ":./") || strings.Contains(route, ".") || strings.Contains(route, ":") || strings.Contains(route, "/") {
		return route
	}
	// Default to the cluster-local service name and port
	return fmt.Sprintf("%s-svc.%s.svc.cluster.local:3333", route, route)
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
