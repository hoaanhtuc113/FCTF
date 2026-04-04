package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func mustGenerateToken(t *testing.T, secret string, payload any) string {
	t.Helper()

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadBytes)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	sigB64 := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payloadB64 + "." + sigB64
}

func TestVerifySuccess(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "unit-test-secret")
	expected := Payload{Exp: time.Now().Unix() + 300, Route: "team-1-2"}
	token := mustGenerateToken(t, "unit-test-secret", expected)

	got, err := Verify(token)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if got.Route != expected.Route || got.Exp != expected.Exp {
		t.Fatalf("Verify() payload = %+v, want %+v", got, expected)
	}
}

func TestVerifyInvalidFormat(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "unit-test-secret")
	_, err := Verify("not-a-valid-token")
	if err == nil || !strings.Contains(err.Error(), "invalid token format") {
		t.Fatalf("expected invalid token format error, got %v", err)
	}
}

func TestVerifyMissingPrivateKey(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "   ")
	_, err := Verify("a.b")
	if err == nil || !strings.Contains(err.Error(), "missing PRIVATE_KEY") {
		t.Fatalf("expected missing PRIVATE_KEY error, got %v", err)
	}
}

func TestVerifyInvalidSignatureEncoding(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "unit-test-secret")
	_, err := Verify("abc.not-base64!@")
	if err == nil || !strings.Contains(err.Error(), "invalid signature encoding") {
		t.Fatalf("expected invalid signature encoding error, got %v", err)
	}
}

func TestVerifyInvalidSignature(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "unit-test-secret")
	token := mustGenerateToken(t, "another-secret", Payload{Exp: time.Now().Unix() + 300, Route: "team-1-2"})
	_, err := Verify(token)
	if err == nil || !strings.Contains(err.Error(), "invalid token signature") {
		t.Fatalf("expected invalid token signature error, got %v", err)
	}
}

func TestVerifyInvalidPayloadEncoding(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "unit-test-secret")
	payloadB64 := "!"
	mac := hmac.New(sha256.New, []byte("unit-test-secret"))
	_, _ = mac.Write([]byte(payloadB64))
	token := payloadB64 + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	_, err := Verify(token)
	if err == nil || !strings.Contains(err.Error(), "invalid payload encoding") {
		t.Fatalf("expected invalid payload encoding error, got %v", err)
	}
}

func TestVerifyInvalidPayloadJSON(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "unit-test-secret")
	payloadB64 := base64.RawURLEncoding.EncodeToString([]byte("not-json"))
	mac := hmac.New(sha256.New, []byte("unit-test-secret"))
	_, _ = mac.Write([]byte(payloadB64))
	token := payloadB64 + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	_, err := Verify(token)
	if err == nil || !strings.Contains(err.Error(), "invalid payload json") {
		t.Fatalf("expected invalid payload json error, got %v", err)
	}
}

func TestVerifyInvalidPayloadContent(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "unit-test-secret")
	token := mustGenerateToken(t, "unit-test-secret", map[string]any{"exp": 0, "route": ""})
	_, err := Verify(token)
	if err == nil || !strings.Contains(err.Error(), "invalid payload content") {
		t.Fatalf("expected invalid payload content error, got %v", err)
	}
}

func TestVerifyExpiredToken(t *testing.T) {
	t.Setenv("PRIVATE_KEY", "unit-test-secret")
	token := mustGenerateToken(t, "unit-test-secret", Payload{Exp: time.Now().Unix() - 1, Route: "team-1-2"})
	_, err := Verify(token)
	if err == nil || !strings.Contains(err.Error(), "token expired") {
		t.Fatalf("expected token expired error, got %v", err)
	}
}

func TestExpandRoute(t *testing.T) {
	tests := []struct {
		name  string
		route string
		want  string
	}{
		{name: "empty route", route: "", want: ""},
		{name: "bare route", route: "team-1-2", want: "team-1-2-svc.team-1-2.svc.cluster.local:3333"},
		{name: "host with dot", route: "example.local", want: "example.local"},
		{name: "route with slash", route: "team/route", want: "team/route"},
		{name: "route with port", route: "10.1.1.1:3333", want: "10.1.1.1:3333"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ExpandRoute(tt.route); got != tt.want {
				t.Fatalf("ExpandRoute() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestLooksLike(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "valid shape", value: "Abcdefghijklmnop.qrstuvwx", want: true},
		{name: "empty", value: "", want: false},
		{name: "missing dot", value: "abcdefghijklmnop", want: false},
		{name: "too many dots", value: "a.b.c", want: false},
		{name: "invalid character", value: "abcde$fghij.klmnopq", want: false},
		{name: "too short", value: "short.token", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := LooksLike(tt.value); got != tt.want {
				t.Fatalf("LooksLike() = %v, want %v", got, tt.want)
			}
		})
	}
}
