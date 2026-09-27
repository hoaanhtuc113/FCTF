package limiter

import (
	"context"
	"fmt"
	"sync"

	"challenge-gateway/internal/config"
)

// RateLimiter decides whether a request identified by key should be allowed.
type RateLimiter interface {
	Allow(ctx context.Context, key string) bool
}

// ConnLimiter tracks concurrent connections identified by key.
type ConnLimiter interface {
	Acquire(ctx context.Context, key string) bool
	Release(ctx context.Context, key string)
}

// Set bundles all rate and connection limiters used by the gateways.
type Set struct {
	HTTPRate      RateLimiter
	HTTPIPRate    RateLimiter
	TCPRate       RateLimiter
	TCPIPConn     ConnLimiter
	TCPTokenConn  ConnLimiter
	TCPGlobalConn ConnLimiter
}

// Init creates all limiters from the provided config and Redis client.
// Returns an error when the Redis client is nil (Redis is required).
func Init(cfg config.Config, redisClient RedisClient) (*Set, error) {
	if redisClient == nil {
		return nil, fmt.Errorf("redis limiter required: REDIS_ADDR is missing or Redis unavailable")
	}

	return &Set{
		HTTPRate:      newRedisRateLimiter(redisClient, cfg.HTTPRate, cfg.HTTPBurst, cfg.RedisKeyPrefix+":http:rl", cfg.RedisFailClosed),
		HTTPIPRate:    newRedisRateLimiter(redisClient, cfg.HTTPIPRate, cfg.HTTPIPBurst, cfg.RedisKeyPrefix+":http:rl:ip", cfg.RedisFailClosed),
		TCPRate:       newRedisRateLimiter(redisClient, cfg.TCPRate, cfg.TCPBurst, cfg.RedisKeyPrefix+":tcp:rl", cfg.RedisFailClosed),
		TCPIPConn:     newRedisConnLimiter(redisClient, cfg.TCPMaxConnsPerIP, cfg.RedisKeyPrefix+":tcp:conn:ip", cfg.TCPConnTTLSeconds, cfg.RedisFailClosed),
		TCPTokenConn:  newRedisConnLimiter(redisClient, cfg.TCPMaxConnsPerToken, cfg.RedisKeyPrefix+":tcp:conn:token", cfg.TCPConnTTLSeconds, cfg.RedisFailClosed),
		TCPGlobalConn: newRedisConnLimiter(redisClient, cfg.TCPMaxConns, cfg.RedisKeyPrefix+":tcp:conn:global", cfg.TCPConnTTLSeconds, cfg.RedisFailClosed),
	}, nil
}

// IPConnLimiter is an in-memory per-IP connection limiter (not used in production
// where Redis is available, but kept as a fallback / for testing).
type IPConnLimiter struct {
	mu    sync.Mutex
	max   int
	count map[string]int
}

func NewIPConnLimiter(max int) *IPConnLimiter {
	return &IPConnLimiter{max: max, count: make(map[string]int)}
}

func (l *IPConnLimiter) Acquire(_ context.Context, ip string) bool {
	if ip == "" || l.max <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.count[ip] >= l.max {
		return false
	}
	l.count[ip]++
	return true
}

func (l *IPConnLimiter) Release(_ context.Context, ip string) {
	if ip == "" || l.max <= 0 {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.count[ip] > 1 {
		l.count[ip]--
		return
	}
	delete(l.count, ip)
}
