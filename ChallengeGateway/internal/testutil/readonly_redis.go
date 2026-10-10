// Package testutil contains Redis fixtures for Gateway regression tests.
package testutil

import (
	"context"
	"errors"
	"strings"

	"github.com/redis/go-redis/v9"
)

// ReadOnlyScripter models the deployment-cache ACL in miniredis, which does
// not implement EVAL_RO or Redis ACL key permissions. Actual ACL enforcement
// is tested separately against redis-server when it is installed.
type ReadOnlyScripter struct{ redis.Scripter }

func (s ReadOnlyScripter) Eval(ctx context.Context, script string, keys []string, args ...interface{}) *redis.Cmd {
	for _, key := range keys {
		if strings.HasPrefix(key, "deploy_challenge_") {
			cmd := redis.NewCmd(ctx)
			cmd.SetErr(errors.New("NOPERM deployment cache is read-only"))
			return cmd
		}
	}
	return s.Scripter.Eval(ctx, script, keys, args...)
}

func (s ReadOnlyScripter) EvalRO(ctx context.Context, script string, keys []string, args ...interface{}) *redis.Cmd {
	return s.Scripter.Eval(ctx, script, keys, args...)
}
