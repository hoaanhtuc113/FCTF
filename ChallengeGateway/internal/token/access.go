package token

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

var ErrRevoked = errors.New("challenge session is no longer active")
var ErrAccessUnavailable = errors.New("challenge authorization is unavailable")

// AccessChecker must consult shared state; a signed token alone is insufficient.
type AccessChecker interface {
	Check(context.Context, string, Payload) error
}

type redisAccess struct{ client redis.Scripter }

func NewAccessChecker(client redis.Scripter) AccessChecker { return &redisAccess{client: client} }

const accessScript = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, session = pcall(cjson.decode, raw)
if not ok then return 0 end
if session.status ~= 'Running' or session.ready ~= true then return 0 end
if session._namespace ~= ARGV[1] or session.challenge_url ~= ARGV[2] then return 0 end
return 1
`

func (a *redisAccess) Check(ctx context.Context, tok string, p Payload) error {
	if p.DeploymentKey == "" || !strings.HasPrefix(p.DeploymentKey, "deploy_challenge_") || time.Now().Unix() >= p.Exp {
		return ErrRevoked
	}
	if a.client == nil {
		return ErrAccessUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	// Deployment cache is read-only for Gateway. EVAL requires write access to
	// declared keys even when the Lua body only reads them.
	result, err := a.client.EvalRO(ctx, accessScript,
		[]string{p.DeploymentKey, "fctf:gateway:revoked:" + p.Route}, p.Route, tok).Int()
	if err != nil {
		return ErrAccessUnavailable
	}
	if result != 1 {
		return ErrRevoked
	}
	return nil
}
