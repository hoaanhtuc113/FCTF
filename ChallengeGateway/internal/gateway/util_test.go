package gateway

import (
	"strings"
	"testing"
)

func TestParseRemoteIP(t *testing.T) {
	tests := []struct {
		name string
		addr string
		want string
	}{
		{name: "empty", addr: "", want: ""},
		{name: "ipv4", addr: "10.10.1.5:3333", want: "10.10.1.5"},
		{name: "ipv6", addr: "[2001:db8::1]:8080", want: "2001:db8::1"},
		{name: "invalid", addr: "10.10.1.5", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ParseRemoteIP(tt.addr); got != tt.want {
				t.Fatalf("ParseRemoteIP() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBuildRateLimitKey(t *testing.T) {
	hashed := hashToken("my-token")
	if len(hashed) != 32 {
		t.Fatalf("hashToken length = %d, want 32", len(hashed))
	}

	if got := BuildRateLimitKey("my-token", "1.2.3.4"); got != "tok:"+hashed+":ip:1.2.3.4" {
		t.Fatalf("unexpected composite key: %q", got)
	}

	if got := BuildRateLimitKey("my-token", ""); got != "tok:"+hashed {
		t.Fatalf("unexpected token-only key: %q", got)
	}

	if got := BuildRateLimitKey("", "1.2.3.4"); got != "1.2.3.4" {
		t.Fatalf("unexpected ip-only key: %q", got)
	}

	if got := BuildRateLimitKey("", ""); got != "" {
		t.Fatalf("unexpected empty key: %q", got)
	}
}

func TestParseTeamChallengeFromRoute(t *testing.T) {
	tests := []struct {
		name      string
		route     string
		wantTeam  int
		wantChall int
		wantOK    bool
	}{
		{
			name:      "k8s host with port",
			route:     "team-10-20-svc.namespace.svc.cluster.local:3333",
			wantTeam:  10,
			wantChall: 20,
			wantOK:    true,
		},
		{
			name:      "suffix after challenge id",
			route:     "team-1-2-extra-svc",
			wantTeam:  1,
			wantChall: 2,
			wantOK:    true,
		},
		{
			name:      "non numeric team id",
			route:     "team-a-2-svc",
			wantTeam:  0,
			wantChall: 0,
			wantOK:    false,
		},
		{
			name:      "wrong prefix",
			route:     "challenge-1-2-svc",
			wantTeam:  0,
			wantChall: 0,
			wantOK:    false,
		},
		{
			name:      "with malformed port still parses name",
			route:     "team-9-8-svc:abc",
			wantTeam:  9,
			wantChall: 8,
			wantOK:    true,
		},
		{
			name:      "empty route",
			route:     "",
			wantTeam:  0,
			wantChall: 0,
			wantOK:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			teamID, challengeID, ok := ParseTeamChallengeFromRoute(tt.route)
			if ok != tt.wantOK || teamID != tt.wantTeam || challengeID != tt.wantChall {
				t.Fatalf("ParseTeamChallengeFromRoute(%q) = (%d, %d, %v), want (%d, %d, %v)",
					tt.route, teamID, challengeID, ok, tt.wantTeam, tt.wantChall, tt.wantOK)
			}
		})
	}
}

func TestHashTokenDeterministicAndLowerHex(t *testing.T) {
	h1 := hashToken("same-input")
	h2 := hashToken("same-input")
	if h1 != h2 {
		t.Fatalf("hashToken should be deterministic")
	}

	if hashToken("") != "" {
		t.Fatalf("hashToken(\"\") should return empty string")
	}

	if len(h1) != 32 {
		t.Fatalf("hashToken length = %d, want 32", len(h1))
	}
	if strings.ToLower(h1) != h1 {
		t.Fatalf("hashToken should be lowercase hex: %q", h1)
	}
}
