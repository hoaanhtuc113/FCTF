package gateway

import (
	"net/http/httptest"
	"testing"
)

func TestPeerIPResolverIgnoresForwardedHeaderFromUntrustedPeer(t *testing.T) {
	resolver, err := newPeerIPResolver("10.0.0.0/8")
	if err != nil {
		t.Fatalf("newPeerIPResolver() error = %v", err)
	}
	request := httptest.NewRequest("GET", "https://challenge.example/", nil)
	request.RemoteAddr = "192.0.2.9:443"
	request.Header.Set("X-Forwarded-For", "198.51.100.5")

	ip, source := resolver.Resolve(request)
	if ip != "192.0.2.9" || source != "remote_addr" {
		t.Fatalf("Resolve() = (%q, %q), want direct peer", ip, source)
	}
}

func TestPeerIPResolverUsesForwardedHeaderFromTrustedPeer(t *testing.T) {
	resolver, err := newPeerIPResolver("10.0.0.0/8")
	if err != nil {
		t.Fatalf("newPeerIPResolver() error = %v", err)
	}
	request := httptest.NewRequest("GET", "https://challenge.example/", nil)
	request.RemoteAddr = "10.12.1.5:443"
	request.Header.Set("X-Forwarded-For", "198.51.100.5, 10.12.1.5")

	ip, source := resolver.Resolve(request)
	if ip != "198.51.100.5" || source != "trusted_x_forwarded_for" {
		t.Fatalf("Resolve() = (%q, %q), want trusted forwarded peer", ip, source)
	}
}
