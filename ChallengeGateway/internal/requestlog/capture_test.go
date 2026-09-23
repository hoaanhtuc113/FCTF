package requestlog

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestBufferBoundsAndDigest(t *testing.T) {
	b := NewBuffer(4)
	_, _ = b.Write([]byte("abcdef"))
	p := b.Part()
	if p.OriginalSize != 6 || p.CapturedSize != 4 || !p.Truncated {
		t.Fatalf("unexpected bounded part: %+v", p)
	}
	if p.BodyBase64 == "" || p.CapturedSHA256 == "" {
		t.Fatal("bounded body must retain encoded bytes and a digest")
	}
}

func TestSanitizedPartRedactsFormAndJSONCredentials(t *testing.T) {
	form := NewBuffer(256)
	_, _ = form.Write([]byte("answer=flag%7Bsafe%7D&fctftoken=opaque&password=hunter2"))
	formPart := form.SanitizedPart("application/x-www-form-urlencoded")
	formBody, _ := base64.StdEncoding.DecodeString(formPart.BodyBase64)
	if strings.Contains(string(formBody), "opaque") || strings.Contains(string(formBody), "hunter2") {
		t.Fatalf("form credentials were retained: %s", formBody)
	}
	if !strings.Contains(string(formBody), "%5BREDACTED%5D") {
		t.Fatalf("form body was not redacted: %s", formBody)
	}

	jsonBody := NewBuffer(256)
	_, _ = jsonBody.Write([]byte(`{"answer":"flag{safe}","nested":{"token":"opaque"}}`))
	jsonPart := jsonBody.SanitizedPart("application/json; charset=utf-8")
	decoded, _ := base64.StdEncoding.DecodeString(jsonPart.BodyBase64)
	if strings.Contains(string(decoded), "opaque") || !strings.Contains(string(decoded), "[REDACTED]") {
		t.Fatalf("json credential was retained: %s", decoded)
	}
}

func TestObjectKeyRejectsPathSegments(t *testing.T) {
	tx := Transaction{InstanceID: "../escape", EventID: "event", OccurredAt: time.Unix(0, 0)}
	if key := ObjectKey(tx); key != "" {
		t.Fatalf("unsafe instance id produced object key %q", key)
	}
}

func TestRedaction(t *testing.T) {
	h := http.Header{}
	h.Set("Authorization", "Bearer secret")
	h.Set("X-Trace", "safe")
	got := SanitizeHeaders(h)
	if got["Authorization"][0] != "[REDACTED]" || got["X-Trace"][0] != "safe" {
		t.Fatalf("unexpected header redaction: %#v", got)
	}
	params := Parameters(map[string][]string{"fctftoken": {"opaque"}, "answer": {"flag"}})
	if params[0].Values[0] != "flag" || params[1].Values[0] != "[REDACTED]" {
		t.Fatalf("unexpected parameter redaction: %#v", params)
	}
}
