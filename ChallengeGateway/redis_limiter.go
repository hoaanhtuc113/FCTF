package main

import (
	"context"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

type redisLimiterClient interface {
	Eval(ctx context.Context, script string, keys []string, args ...interface{}) *redis.Cmd
	Ping(ctx context.Context) *redis.StatusCmd
}

type redisRateLimiter struct {
	client redisLimiterClient
	rate   float64
	burst  int
	prefix string
	ttl    time.Duration
	script string
}

func newRedisRateLimiter(client redisLimiterClient, rate float64, burst int, prefix string) *redisRateLimiter {
	return &redisRateLimiter{
		client: client,
		rate:   rate,
		burst:  burst,
		prefix: prefix,
		ttl:    10 * time.Minute,
		script: redisRateLimitScript,
	}
}

func (rl *redisRateLimiter) Allow(ctx context.Context, key string) bool {
	if key == "" || rl.rate <= 0 || rl.burst <= 0 {
		return true
	}
	redisKey := rl.prefix + ":" + key
	res, err := rl.client.Eval(ctx, rl.script, []string{redisKey}, rl.rate, rl.burst, int(rl.ttl.Seconds())).Int()
	if err != nil {
		log.Printf("redis rate limit error: %v", err)
		return true
	}
	return res == 1
}

type redisConnLimiter struct {
	client redisLimiterClient
	max    int
	prefix string
	ttl    time.Duration
}

func newRedisConnLimiter(client redisLimiterClient, max int, prefix string) *redisConnLimiter {
	return &redisConnLimiter{
		client: client,
		max:    max,
		prefix: prefix,
		ttl:    1 * time.Hour,
	}
}

func (l *redisConnLimiter) Acquire(ctx context.Context, key string) bool {
	if key == "" || l.max <= 0 {
		return true
	}
	redisKey := l.prefix + ":" + key
	res, err := l.client.Eval(ctx, redisConnAcquireScript, []string{redisKey}, l.max, int(l.ttl.Seconds())).Int()
	if err != nil {
		log.Printf("redis conn acquire error: %v", err)
		return true
	}
	return res == 1
}

func (l *redisConnLimiter) Release(ctx context.Context, key string) {
	if key == "" || l.max <= 0 {
		return
	}
	redisKey := l.prefix + ":" + key
	_, _ = l.client.Eval(ctx, redisConnReleaseScript, []string{redisKey}).Result()
}

func initRedis(cfg gatewayConfig) redisLimiterClient {
	if cfg.RedisAddr == "" {
		return nil
	}

	client := redis.NewClient(&redis.Options{
		Addr:         cfg.RedisAddr,
		Password:     cfg.RedisPassword,
		DB:           cfg.RedisDB,
		PoolSize:     cfg.RedisPoolSize,
		MinIdleConns: cfg.RedisMinIdle,
		DialTimeout:  2 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("redis unavailable: %v", err)
		return nil
	}

	return client
}

const redisRateLimitScript = `
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local now = redis.call("TIME")
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)

local data = redis.call("HMGET", KEYS[1], "tokens", "ts")
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil or ts == nil then
  tokens = burst
  ts = nowMs
end

local delta = math.max(0, nowMs - ts) / 1000.0
tokens = math.min(burst, tokens + delta * rate)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call("HMSET", KEYS[1], "tokens", tokens, "ts", nowMs)
redis.call("EXPIRE", KEYS[1], ttl)
return allowed
`

const redisConnAcquireScript = `
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ttl)
end

if current > max then
  redis.call("DECR", KEYS[1])
  return 0
end

return 1
`

const redisConnReleaseScript = `
local current = redis.call("DECR", KEYS[1])
if current <= 0 then
  redis.call("DEL", KEYS[1])
end
return current
`