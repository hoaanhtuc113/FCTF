package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

// Payload is the decoded content of a challenge access token.
type Payload struct {
	Exp          int64  `json:"exp"`
	Route        string `json:"route"`
	InstanceID   string `json:"instance_id,omitempty"`
	ContestID    *int   `json:"contest_id,omitempty"`
	ChallengeID  *int   `json:"challenge_id,omitempty"`
	ActorUserRef string `json:"actor_user_ref,omitempty"`
	ActorTeamID  *int   `json:"actor_team_id,omitempty"`
}

var namespacePattern = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$`)

// Verify parses and validates a token string, returning its payload on success.
func Verify(token string) (Payload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return Payload{}, fmt.Errorf("invalid token format")
	}

	// Challenge access assertions have their own signing key. PRIVATE_KEY remains
	// a temporary compatibility fallback for tokens minted before the key split;
	// deployments must set CHALLENGE_ACCESS_TOKEN_KEY before enabling instance
	// request logs.
	secret := os.Getenv("CHALLENGE_ACCESS_TOKEN_KEY")
	if strings.TrimSpace(secret) == "" {
		secret = os.Getenv("PRIVATE_KEY")
	}
	if strings.TrimSpace(secret) == "" {
		return Payload{}, fmt.Errorf("missing challenge access token signing key")
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
		// Do not log either half of a failed assertion. A token can be carried in
		// a query string and access telemetry must never become a token sink.
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

	if payload.Exp <= 0 || !namespacePattern.MatchString(payload.Route) {
		return Payload{}, fmt.Errorf("invalid payload content")
	}

	if time.Now().Unix() > payload.Exp {
		return Payload{}, fmt.Errorf("token expired")
	}

	return payload, nil
}

// ExpandRoute turns a signed bare namespace into the one fixed Service address
// the gateway is allowed to reach. Assertions must never select arbitrary hosts,
// ports, URLs, or cluster-local suffixes.
func ExpandRoute(route string) (string, error) {
	if !namespacePattern.MatchString(route) {
		return "", fmt.Errorf("invalid route")
	}
	return fmt.Sprintf("%s-svc.%s.svc.cluster.local:3333", route, route), nil
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
