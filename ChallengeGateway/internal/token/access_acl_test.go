package token

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// This regression needs Redis 7+ to exercise real %R~ key permissions.
// It starts its own temporary server; it never connects to production Redis.
func TestAccessWithRealReadOnlyACL(t *testing.T) {
	binary, err := exec.LookPath("redis-server")
	if err != nil {
		t.Skip("redis-server not installed; real ACL integration test requires Redis 7+")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	dir := t.TempDir()
	logFile, err := os.Create(filepath.Join(dir, "redis.log"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { logFile.Close() })
	process := exec.Command(binary, "--bind", "127.0.0.1", "--port", strconv.Itoa(port),
		"--save", "", "--appendonly", "no", "--dir", dir)
	process.Stdout, process.Stderr = logFile, logFile
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		process.Process.Kill()
		process.Wait()
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	admin := redis.NewClient(&redis.Options{Addr: addr, MaxRetries: -1})
	t.Cleanup(func() { admin.Close() })
	for admin.Ping(ctx).Err() != nil {
		select {
		case <-ctx.Done():
			t.Fatal("isolated Redis did not start")
		case <-time.After(20 * time.Millisecond):
		}
	}
	if err := admin.Do(ctx, "ACL", "SETUSER", "gateway_test", "reset", "on", "nopass",
		"+ping", "+get", "+exists", "+eval", "+eval_ro", "%R~deploy_challenge_*",
		"~fctf:gateway:*").Err(); err != nil {
		t.Fatalf("Redis 7+ ACL setup failed: %v", err)
	}
	client := redis.NewClient(&redis.Options{Addr: addr, Username: "gateway_test", MaxRetries: -1})
	t.Cleanup(func() { client.Close() })
	p := Payload{Route: "acl-test", DeploymentKey: "deploy_challenge_10_1", Exp: time.Now().Unix() + 60}
	state := `{"status":"Running","ready":true,"_namespace":"acl-test","challenge_url":"token"}`
	if err := admin.Set(ctx, p.DeploymentKey, state, time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	if err := client.Eval(ctx, "return 1", []string{p.DeploymentKey}).Err(); err == nil || !strings.Contains(err.Error(), "NOPERM") {
		t.Fatalf("EVAL must be denied on the read-only cache: %v", err)
	}
	if err := NewAccessChecker(client).Check(ctx, "token", p); err != nil {
		t.Fatalf("active session must work with read-only ACL: %v", err)
	}
	if err := client.Set(ctx, p.DeploymentKey, "tampered", time.Minute).Err(); err == nil || !strings.Contains(err.Error(), "NOPERM") {
		t.Fatalf("Gateway must not be able to overwrite deployment cache: %v", err)
	}
	if err := admin.Set(ctx, "fctf:gateway:revoked:"+p.Route, "1", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	if err := NewAccessChecker(client).Check(ctx, "token", p); !errors.Is(err, ErrRevoked) {
		t.Fatalf("revoked session must be denied: %v", err)
	}
	if err := admin.Del(ctx, "fctf:gateway:revoked:"+p.Route, p.DeploymentKey).Err(); err != nil {
		t.Fatal(err)
	}
	if err := NewAccessChecker(client).Check(ctx, "token", p); !errors.Is(err, ErrRevoked) {
		t.Fatalf("missing deployment must be denied: %v", err)
	}
}
