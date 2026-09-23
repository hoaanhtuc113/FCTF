package limiter

import (
	"context"
	"log"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// CaptureQuota limits request-log bytes in Redis. Unlike traffic limiters it
// fails closed for capture only: a Redis error means no content is persisted,
// never that a participant request is rejected.
type CaptureQuota interface {
	Allow(ctx context.Context, instanceID string, contestID *int, bytes int64) bool
}

type redisCaptureQuota struct {
	client RedisClient
	prefix string
	max    int64
	window int
	script *redis.Script
}

func newRedisCaptureQuota(client RedisClient, prefix string, max int64, window int) CaptureQuota {
	if client == nil || max <= 0 || window <= 0 {
		return denyCaptureQuota{}
	}
	return &redisCaptureQuota{client: client, prefix: prefix, max: max, window: window, script: redis.NewScript(captureQuotaScriptSource)}
}

func (q *redisCaptureQuota) Allow(ctx context.Context, instanceID string, contestID *int, bytes int64) bool {
	if q == nil || instanceID == "" || contestID == nil || *contestID < 0 || bytes <= 0 {
		return false
	}
	// Redis TIME avoids clock skew between Gateway replicas. Bucket boundaries
	// are stable per contest/instance and auto-expire shortly after the window.
	window := q.window
	res, err := q.script.Run(ctx, q.client, []string{q.prefix + ":" + strconv.Itoa(*contestID) + ":" + instanceID}, q.max, bytes, window).Int()
	if err != nil {
		log.Printf("request-log quota unavailable; skipping content capture: %v", err)
		return false
	}
	return res == 1
}

type denyCaptureQuota struct{}

func (denyCaptureQuota) Allow(_ context.Context, _ string, _ *int, _ int64) bool {
	// There is no safe unlimited fallback for raw content.
	return false
}

const captureQuotaScriptSource = `
local max = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
local now = redis.call("TIME")
local slot = math.floor(tonumber(now[1]) / window)
local key = KEYS[1] .. ":" .. slot
local current = tonumber(redis.call("GET", key) or "0")
if current + cost > max then
  return 0
end
redis.call("INCRBY", key, cost)
redis.call("EXPIRE", key, window + 60)
return 1
`
