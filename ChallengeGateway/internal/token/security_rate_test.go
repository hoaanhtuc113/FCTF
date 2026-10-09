package token

import (
	"context"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// Execute the production Python/.NET limiter scripts, rather than a copy.
func TestSecurityCountersAreAtomicAndExpire(t *testing.T) {
	for _, source := range []struct{ path, pattern string }{
		{"../../../FCTF-ManagementPlatform/CTFd/utils/security/login_limit.py", `(?s)LOGIN_COUNTER_SCRIPT = """(.*?)"""`},
		{"../../../ControlCenterAndChallengeHostingServer/ContestantBE/RateLimiting/SensitiveRateLimitMiddleware.cs", `(?s)CounterScript = """(.*?)"""`},
	} {
		t.Run(source.path, func(t *testing.T) {
			data, err := os.ReadFile(source.path)
			if err != nil {
				t.Fatal(err)
			}
			match := regexp.MustCompile(source.pattern).FindStringSubmatch(string(data))
			if len(match) != 2 {
				t.Fatal("production counter script not found")
			}
			script := strings.TrimSpace(match[1])
			server := miniredis.RunT(t)
			client := redis.NewClient(&redis.Options{Addr: server.Addr()})
			defer client.Close()
			ctx := context.Background()
			key := "fctf:security:test"
			counts := make(chan int64, 30)
			failures := make(chan error, 30)
			var wg sync.WaitGroup
			for i := 0; i < 30; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					values, err := client.Eval(ctx, script, []string{key}, 60).Int64Slice()
					if err != nil {
						failures <- err
						return
					}
					counts <- values[0]
				}()
			}
			wg.Wait()
			close(counts)
			close(failures)
			for err := range failures {
				t.Error(err)
			}
			seen := make(map[int64]bool)
			for count := range counts {
				if seen[count] {
					t.Fatal("concurrent requests lost a counter increment")
				}
				seen[count] = true
			}
			if len(seen) != 30 || !seen[30] {
				t.Fatal("wrong counter budget")
			}
			server.FastForward(10 * time.Second)
			values, err := client.Eval(ctx, script, []string{key}, 60).Int64Slice()
			if err != nil || values[0] != 31 || values[1] != 50 {
				t.Fatalf("sliding or incorrect window: %v %v", values, err)
			}
			server.FastForward(51 * time.Second)
			values, err = client.Eval(ctx, script, []string{key}, 60).Int64Slice()
			if err != nil || values[0] != 1 || values[1] != 60 {
				t.Fatalf("expired budget did not reset: %v %v", values, err)
			}
		})
	}
}
