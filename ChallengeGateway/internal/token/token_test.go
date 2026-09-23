package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func TestVerifyAcceptsRollingKeyByKID(t *testing.T) {
	t.Setenv("CHALLENGE_ACCESS_TOKEN_KEY", "")
	t.Setenv("CHALLENGE_ACCESS_TOKEN_KEYS", "previous:old-secret,current:new-secret")

	value := Payload{
		Exp:        time.Now().Add(time.Minute).Unix(),
		Route:      "team-1-2",
		KeyID:      "current",
		JTI:        "opaque-transaction-id",
		InstanceID: "instance-123",
	}
	raw := signedPayload(t, value, "new-secret")

	got, err := Verify(raw)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if got.KeyID != "current" || got.JTI != value.JTI || got.InstanceID != value.InstanceID {
		t.Fatalf("Verify() payload = %#v, want %#v", got, value)
	}
}

func TestVerifyRejectsTokenSignedByWrongKeyForKID(t *testing.T) {
	t.Setenv("CHALLENGE_ACCESS_TOKEN_KEY", "")
	t.Setenv("CHALLENGE_ACCESS_TOKEN_KEYS", "current:new-secret")

	raw := signedPayload(t, Payload{
		Exp:   time.Now().Add(time.Minute).Unix(),
		Route: "team-1-2",
		KeyID: "current",
	}, "old-secret")

	if _, err := Verify(raw); err == nil {
		t.Fatal("Verify() accepted an assertion signed by a different key")
	}
}

func signedPayload(t *testing.T, payload Payload, secret string) string {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(data)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	return payloadB64 + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
