package requestlog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestS3PutUsesSignedTLSRequestAndEncryption(t *testing.T) {
	var method, path, authorization, sse string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		authorization, sse = r.Header.Get("Authorization"), r.Header.Get("x-amz-server-side-encryption")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	store, err := NewS3ObjectStore(S3Config{
		Endpoint: server.URL, Bucket: "fctf.request-logs", Region: "us-east-1",
		AccessKeyID: "writer", SecretAccessKey: "secret", PathStyle: true, HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatal(err)
	}
	key := "request-logs/2026/09/23/instance-1/event-1/transaction.json.gz"
	if err := store.Put(context.Background(), key, strings.NewReader("payload")); err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPut || path != "/fctf.request-logs/"+key {
		t.Fatalf("unexpected request %s %s", method, path)
	}
	if !strings.HasPrefix(authorization, "AWS4-HMAC-SHA256 Credential=writer/") || sse != "AES256" {
		t.Fatalf("missing signed encryption headers: auth=%q sse=%q", authorization, sse)
	}
}

func TestS3RejectsPlaintextEndpoint(t *testing.T) {
	if _, err := NewS3ObjectStore(S3Config{Endpoint: "http://object.local", Bucket: "logs", AccessKeyID: "id", SecretAccessKey: "secret"}); err == nil {
		t.Fatal("plaintext endpoint was accepted")
	}
}
