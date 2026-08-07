package limiter

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net"
	"os"
	"time"

	"github.com/redis/go-redis/v9"

	"challenge-gateway/internal/config"
)

// RedisClient is the minimal interface required by the Redis-backed limiters.
type RedisClient interface {
	redis.Scripter
	Ping(ctx context.Context) *redis.StatusCmd
}

// redisTLSConfig builds the TLS settings for the Redis connection.
//
// Without a CA the best available option is an encrypted-but-unauthenticated
// connection: it stops passive sniffing of the ACL password and the rate-limit
// keys, but an attacker able to redirect the traffic can still present its own
// certificate. Pointing REDIS_TLS_CA_FILE at the CA that signed the Redis
// server certificate closes that hole, and takes precedence over
// REDIS_TLS_INSECURE_SKIP_VERIFY so the two settings can't contradict.
func redisTLSConfig(cfg config.Config) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: cfg.RedisTLSInsecureSkipVerify,
	}
	if host, _, err := net.SplitHostPort(cfg.RedisAddr); err == nil {
		tlsConfig.ServerName = host
	}

	if cfg.RedisTLSCAFile == "" {
		return tlsConfig, nil
	}

	pemBytes, err := os.ReadFile(cfg.RedisTLSCAFile)
	if err != nil {
		return nil, fmt.Errorf("read REDIS_TLS_CA_FILE: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pemBytes) {
		return nil, fmt.Errorf("REDIS_TLS_CA_FILE %q holds no usable certificate", cfg.RedisTLSCAFile)
	}
	tlsConfig.RootCAs = pool
	tlsConfig.InsecureSkipVerify = false

	return tlsConfig, nil
}

// InitRedis creates a Redis client from config and verifies connectivity.
// Returns a nil client when Redis is unavailable and RedisFailClosed is false;
// returns an error only for a TLS configuration the operator got wrong, which
// is worth refusing to start over rather than quietly downgrading.
func InitRedis(cfg config.Config) (RedisClient, error) {
	if cfg.RedisAddr == "" {
		return nil, nil
	}

	opts := &redis.Options{
		Addr:         cfg.RedisAddr,
		Username:     cfg.RedisUsername,
		Password:     cfg.RedisPassword,
		DB:           cfg.RedisDB,
		PoolSize:     cfg.RedisPoolSize,
		MinIdleConns: cfg.RedisMinIdle,
		DialTimeout:  2 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	}
	if cfg.RedisTLS {
		tlsConfig, err := redisTLSConfig(cfg)
		if err != nil {
			return nil, err
		}
		opts.TLSConfig = tlsConfig
	} else {
		log.Printf("WARNING: REDIS_TLS is off - credentials and rate-limit traffic to %s travel in cleartext", cfg.RedisAddr)
	}
	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("redis unavailable: %v", err)
		if cfg.RedisFailClosed {
			return client, nil
		}
		return nil, nil
	}

	return client, nil
}

// ── rate limiter ──────────────────────────────────────────────────────────────

type redisRateLimiter struct {
	client     RedisClient
	rate       float64
	burst      int
	prefix     string
	ttl        time.Duration
	script     *redis.Script
	failClosed bool
}

func newRedisRateLimiter(client RedisClient, rate float64, burst int, prefix string, failClosed bool) *redisRateLimiter {
	return &redisRateLimiter{
		client:     client,
		rate:       rate,
		burst:      burst,
		prefix:     prefix,
		ttl:        10 * time.Minute,
		script:     redisRateLimitScript,
		failClosed: failClosed,
	}
}

func (rl *redisRateLimiter) Allow(ctx context.Context, key string) bool {
	if key == "" || rl.rate <= 0 || rl.burst <= 0 {
		return true
	}
	redisKey := rl.prefix + ":" + key
	res, err := rl.script.Run(ctx, rl.client, []string{redisKey}, rl.rate, rl.burst, int(rl.ttl.Seconds())).Int()
	if err != nil {
		log.Printf("redis rate limit error: %v", err)
		return !rl.failClosed
	}
	return res == 1
}

// ── connection limiter ────────────────────────────────────────────────────────

type redisConnLimiter struct {
	client        RedisClient
	max           int
	prefix        string
	ttl           time.Duration
	scriptAcquire *redis.Script
	scriptRelease *redis.Script
	failClosed    bool
}

func newRedisConnLimiter(client RedisClient, max int, prefix string, ttlSeconds int, failClosed bool) *redisConnLimiter {
	if ttlSeconds <= 0 {
		ttlSeconds = 900
	}
	return &redisConnLimiter{
		client:        client,
		max:           max,
		prefix:        prefix,
		ttl:           time.Duration(ttlSeconds) * time.Second,
		scriptAcquire: redisConnAcquireScript,
		scriptRelease: redisConnReleaseScript,
		failClosed:    failClosed,
	}
}

func (l *redisConnLimiter) Acquire(ctx context.Context, key string) bool {
	if key == "" || l.max <= 0 {
		return true
	}
	redisKey := l.prefix + ":" + key
	res, err := l.scriptAcquire.Run(ctx, l.client, []string{redisKey}, l.max, int(l.ttl.Seconds())).Int()
	if err != nil {
		log.Printf("redis conn acquire error: %v", err)
		return !l.failClosed
	}
	return res == 1
}

func (l *redisConnLimiter) Release(ctx context.Context, key string) {
	if key == "" || l.max <= 0 {
		return
	}
	redisKey := l.prefix + ":" + key
	_, _ = l.scriptRelease.Run(ctx, l.client, []string{redisKey}, int(l.ttl.Seconds())).Result()
}

// ── Lua scripts ───────────────────────────────────────────────────────────────

const redisRateLimitScriptSource = `
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

const redisConnAcquireScriptSource = `
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ttl)

if current > max then
  redis.call("DECR", KEYS[1])
  return 0
end

return 1
`

const redisConnReleaseScriptSource = `
local ttl = tonumber(ARGV[1])
local current = redis.call("DECR", KEYS[1])
if current <= 0 then
  redis.call("DEL", KEYS[1])
  return current
end
redis.call("EXPIRE", KEYS[1], ttl)
return current
`

var (
	redisRateLimitScript   = redis.NewScript(redisRateLimitScriptSource)
	redisConnAcquireScript = redis.NewScript(redisConnAcquireScriptSource)
	redisConnReleaseScript = redis.NewScript(redisConnReleaseScriptSource)
)
