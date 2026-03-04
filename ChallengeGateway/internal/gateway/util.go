package gateway

import (
	"crypto/sha256"
	"encoding/hex"
	"net"
	"strconv"
	"strings"
)

// ParseRemoteIP extracts the host part from a "host:port" remote address string.
func ParseRemoteIP(addr string) string {
	if addr == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return ""
	}
	return host
}

// BuildRateLimitKey builds a composite rate-limit key from a token and client IP.
// When both are present the key is "tok:<hash>:ip:<ip>", so per-token-per-IP
// buckets are used. Falls back to token-only or IP-only as available.
func BuildRateLimitKey(token, ip string) string {
	hashed := hashToken(token)
	switch {
	case hashed != "" && ip != "":
		return "tok:" + hashed + ":ip:" + ip
	case hashed != "":
		return "tok:" + hashed
	default:
		return ip
	}
}

func hashToken(token string) string {
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:16])
}

// ParseTeamChallengeFromRoute tries to extract (teamID, challengeID) from a
// k8s service DNS name such as "team-1-2-svc.namespace.svc.cluster.local:3333".
func ParseTeamChallengeFromRoute(routeOrHost string) (teamID int, challengeID int, ok bool) {
	name := strings.TrimSpace(routeOrHost)
	if name == "" {
		return 0, 0, false
	}

	// Strip port.
	if h, _, err := net.SplitHostPort(name); err == nil {
		name = h
	} else if i := strings.LastIndexByte(name, ':'); i > 0 {
		name = name[:i]
	}

	// For k8s DNS, only the leftmost label matters.
	if i := strings.IndexByte(name, '.'); i > 0 {
		name = name[:i]
	}
	name = strings.TrimSuffix(name, "-svc")

	// Expected format: "team-<teamID>-<challengeID>[-...]"
	parts := strings.Split(name, "-")
	if len(parts) < 3 || parts[0] != "team" {
		return 0, 0, false
	}

	t, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, false
	}
	c, err := strconv.Atoi(parts[2])
	if err != nil {
		return 0, 0, false
	}

	return t, c, true
}
