package requestlog

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestSanitizedPartRedactsJSONCredentialsBeforeEncoding(t *testing.T) {
	body := []byte(`{"username":"alice","password":"hunter2","nested":{"api_key":"secret-value","pwd":"short-secret"}}`)
	buffer := NewBuffer(4096)
	_, _ = buffer.Write(body)

	part := buffer.SanitizedPart("application/json")
	decoded, err := base64.StdEncoding.DecodeString(part.BodyBase64)
	if err != nil {
		t.Fatalf("decode captured body: %v", err)
	}
	if strings.Contains(string(decoded), "hunter2") || strings.Contains(string(decoded), "secret-value") || strings.Contains(string(decoded), "short-secret") {
		t.Fatalf("captured JSON contains a credential: %s", decoded)
	}
	var value map[string]any
	if err := json.Unmarshal(decoded, &value); err != nil {
		t.Fatalf("captured JSON is invalid: %v", err)
	}
	if value["password"] != "[REDACTED]" {
		t.Fatalf("password was not redacted: %#v", value["password"])
	}
	nested := value["nested"].(map[string]any)
	if nested["api_key"] != "[REDACTED]" {
		t.Fatalf("nested API key was not redacted: %#v", nested["api_key"])
	}
	if nested["pwd"] != "[REDACTED]" {
		t.Fatalf("short password key was not redacted: %#v", nested["pwd"])
	}
	if part.OriginalSize != int64(len(body)) || part.Truncated {
		t.Fatalf("unexpected capture metadata: %#v", part)
	}
}

func TestSanitizedPartEnforcesByteLimit(t *testing.T) {
	buffer := NewBuffer(4)
	_, _ = buffer.Write([]byte("abcdef"))
	part := buffer.SanitizedPart("text/plain")
	decoded, err := base64.StdEncoding.DecodeString(part.BodyBase64)
	if err != nil {
		t.Fatalf("decode captured body: %v", err)
	}
	if string(decoded) != "abcd" || part.CapturedSize != 4 || part.OriginalSize != 6 || !part.Truncated {
		t.Fatalf("capture limit was not applied: body=%q part=%#v", decoded, part)
	}
}

func TestSanitizedPartDropsMalformedStructuredBody(t *testing.T) {
	for _, test := range []struct {
		name        string
		contentType string
		body        string
		limit       int
	}{
		{name: "truncated JSON", contentType: "application/json", body: `{"password":"hunter2","other":"payload"}`, limit: 24},
		{name: "malformed JSON", contentType: "application/json", body: `{"password":"hunter2",`, limit: 4096},
		{name: "malformed form", contentType: "application/x-www-form-urlencoded", body: "password=hunter2&x=%ZZ", limit: 4096},
	} {
		t.Run(test.name, func(t *testing.T) {
			buffer := NewBuffer(test.limit)
			_, _ = buffer.Write([]byte(test.body))
			part := buffer.SanitizedPart(test.contentType)
			if part.BodyBase64 != "" || part.CapturedSize != 0 || !part.Truncated || part.OriginalSize != int64(len(test.body)) {
				t.Fatalf("malformed structured body was retained: %#v", part)
			}
		})
	}
}

func TestSanitizedPartRedactsVendorJSON(t *testing.T) {
	buffer := NewBuffer(4096)
	_, _ = buffer.Write([]byte(`{"pwd":"vendor-secret"}`))
	part := buffer.SanitizedPart("application/problem+json; charset=utf-8")
	decoded, err := base64.StdEncoding.DecodeString(part.BodyBase64)
	if err != nil || strings.Contains(string(decoded), "vendor-secret") || part.Truncated {
		t.Fatalf("vendor JSON credential was retained: body=%q part=%#v err=%v", decoded, part, err)
	}
}

func TestSanitizeHeadersRedactsCredentialHeaders(t *testing.T) {
	headers := http.Header{
		"Authorization": {"Bearer secret"},
		"Cookie":        {"session=secret"},
		"Content-Type":  {"application/json"},
	}
	got := SanitizeHeadersLimited(headers, 1024)
	if got["Authorization"][0] != "[REDACTED]" || got["Cookie"][0] != "[REDACTED]" {
		t.Fatalf("credential headers were not redacted: %#v", got)
	}
	if got["Content-Type"][0] != "application/json" {
		t.Fatalf("non-sensitive header was lost: %#v", got)
	}
}

func TestHeadersAndParametersCountNamesAgainstLimit(t *testing.T) {
	headers := http.Header{"X-Password": {"secret"}}
	if got := SanitizeHeadersLimited(headers, len("X-Password")); len(got) != 0 {
		t.Fatalf("sensitive header exceeded the cap: %#v", got)
	}
	params := url.Values{"password": {"secret"}}
	if got := ParametersLimited(params, len("password")); len(got) != 0 {
		t.Fatalf("sensitive parameter exceeded the cap: %#v", got)
	}
}

func TestObjectKeyIsScopedToNamespaceAndEvent(t *testing.T) {
	tx := Transaction{
		OccurredAt:        time.Date(2026, 9, 28, 12, 30, 0, 0, time.UTC),
		InstanceNamespace: "team-13-9-example",
		EventID:           "01993a76-1234-7abc-8def-0123456789ab",
	}
	want := "request-logs/2026/09/28/team-13-9-example/01993a76-1234-7abc-8def-0123456789ab/transaction.json.gz"
	if got := ObjectKey(tx); got != want {
		t.Fatalf("ObjectKey() = %q, want %q", got, want)
	}
	tx.InstanceNamespace = "../other-tenant"
	if got := ObjectKey(tx); got != "" {
		t.Fatalf("unsafe namespace produced object key %q", got)
	}
}
