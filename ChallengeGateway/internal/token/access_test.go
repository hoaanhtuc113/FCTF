package token

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"challenge-gateway/internal/testutil"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestAccessRequiresCurrentActiveSession(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	checker := NewAccessChecker(testutil.ReadOnlyScripter{Scripter: client})
	p := Payload{Route: "team-1-10-test-123", DeploymentKey: "deploy_challenge_10_1", Exp: time.Now().Unix() + 60}
	for _, test := range []struct {
		name    string
		session string
		allow   bool
	}{
		{"running", `{"status":"Running","ready":true,"_namespace":"team-1-10-test-123","challenge_url":"token"}`, true},
		{"stopping", `{"status":"Deleting","ready":false,"_namespace":"team-1-10-test-123","challenge_url":"token"}`, false},
		{"not ready", `{"status":"Running","ready":false,"_namespace":"team-1-10-test-123","challenge_url":"token"}`, false},
		{"new instance", `{"status":"Running","ready":true,"_namespace":"team-1-10-test-456","challenge_url":"token"}`, false},
		{"new token", `{"status":"Running","ready":true,"_namespace":"team-1-10-test-123","challenge_url":"new-token"}`, false},
		{"corrupt cache", `{broken`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			server.Set(p.DeploymentKey, test.session)
			err := checker.Check(context.Background(), "token", p)
			if (err == nil) != test.allow {
				t.Fatalf("allow=%v err=%v", test.allow, err)
			}
		})
	}
	server.Del(p.DeploymentKey)
	if !errors.Is(checker.Check(context.Background(), "token", p), ErrRevoked) {
		t.Fatal("missing session accepted")
	}
	p.DeploymentKey = ""
	if !errors.Is(checker.Check(context.Background(), "token", p), ErrRevoked) {
		t.Fatal("legacy token accepted")
	}
}

func TestRevocationSurvivesLateCacheWrite(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	p := Payload{Route: "old", DeploymentKey: "deploy_challenge_10_1", Exp: time.Now().Unix() + 60}
	server.Set("fctf:gateway:revoked:old", "1")
	server.Set(p.DeploymentKey, `{"status":"Running","ready":true,"_namespace":"old","challenge_url":"old-token"}`)
	if !errors.Is(NewAccessChecker(testutil.ReadOnlyScripter{Scripter: client}).Check(context.Background(), "old-token", p), ErrRevoked) {
		t.Fatal("late write restored access")
	}
	p.Route = "new"
	server.Set(p.DeploymentKey, `{"status":"Running","ready":true,"_namespace":"new","challenge_url":"new-token"}`)
	if err := NewAccessChecker(testutil.ReadOnlyScripter{Scripter: client}).Check(context.Background(), "new-token", p); err != nil {
		t.Fatal(err)
	}
	p.Exp = time.Now().Unix()
	if !errors.Is(NewAccessChecker(testutil.ReadOnlyScripter{Scripter: client}).Check(context.Background(), "new-token", p), ErrRevoked) {
		t.Fatal("expiry boundary accepted")
	}
}

func TestRedisFailureDeniesAccess(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	server.Close()
	p := Payload{Route: "old", DeploymentKey: "deploy_challenge_10_1", Exp: time.Now().Unix() + 60}
	if !errors.Is(NewAccessChecker(testutil.ReadOnlyScripter{Scripter: client}).Check(context.Background(), "token", p), ErrAccessUnavailable) {
		t.Fatal("Redis failure accepted")
	}
}

// Execute the production C# Lua script against Redis semantics, so tests cover
// the actual publisher guard rather than a reimplementation in a fake database.
func TestProductionPublisherCannotReviveStoppedSession(t *testing.T) {
	source, err := os.ReadFile("../../../ControlCenterAndChallengeHostingServer/ResourceShared/Utils/RedisHelper.cs")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(source), "public async Task<bool> AtomicUpdateExpiration(")
	match := regexp.MustCompile(`(?s)var script = @"(.*?)";`).FindStringSubmatch(string(source)[start:])
	if len(match) != 2 {
		t.Fatal("publisher Lua script not found")
	}
	script := strings.ReplaceAll(match[1], `""`, `"`)
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	defer client.Close()
	ctx := context.Background()
	key := "deploy_challenge_10_1"
	for _, test := range []struct {
		name, state, namespace string
		revoked                bool
		expected               int
	}{
		{"normal ready", "Pending", "old", false, 1},
		{"stopped state", "Deleting", "old", false, 0},
		{"late ready after revoke", "Pending", "old", true, 0},
		{"old event after new namespace", "Pending", "new", false, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			server.FlushAll()
			client.ZAdd(ctx, "active_deploys_team_1", redis.Z{Score: 100, Member: "10"})
			data, _ := json.Marshal(map[string]any{"status": test.state, "_namespace": test.namespace})
			server.Set(key, string(data))
			if test.revoked {
				server.Set("fctf:gateway:revoked:old", "1")
			}
			incoming := `{"status":"Running","_namespace":"old","ready":true,"challenge_url":"new-token"}`
			result, err := client.Eval(ctx, script, []string{"active_deploys_team_1", key}, "10", time.Now().Unix()+60, 60, incoming, 1).Int()
			if err != nil || result != test.expected {
				t.Fatalf("result=%d err=%v", result, err)
			}
			saved, _ := server.Get(key)
			if test.expected == 0 && saved == incoming {
				t.Fatal("denied update still changed cache")
			}
		})
	}
}
