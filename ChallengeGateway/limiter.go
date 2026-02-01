package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"strconv"
	"sync"
	"time"
)

type rateLimiter interface {
	Allow(ctx context.Context, key string) bool
}

type localRateLimiter struct {
	mu     sync.Mutex
	rate   float64
	burst  float64
	tokens map[string]float64
	last   map[string]time.Time
}

func newLocalRateLimiter(rate float64, burst int) *localRateLimiter {
	return &localRateLimiter{
		rate:   rate,
		burst:  float64(burst),
		tokens: make(map[string]float64),
		last:   make(map[string]time.Time),
	}
}

func initLimiters(cfg gatewayConfig, redisClient redisLimiterClient) error {
	if redisClient == nil {
		httpRateLimiter = nil
		tcpRateLimiter = nil
		tcpIPConnLimiter = nil
		tcpTokenConnLimiter = nil
		tcpGlobalConnLimiter = nil
		return fmt.Errorf("redis limiter required: REDIS_ADDR is missing or Redis unavailable")
	}

	httpRateLimiter = newRedisRateLimiter(redisClient, cfg.HTTPRate, cfg.HTTPBurst, cfg.RedisKeyPrefix+":http:rl", cfg.RedisFailClosed)
	tcpRateLimiter = newRedisRateLimiter(redisClient, cfg.TCPRate, cfg.TCPBurst, cfg.RedisKeyPrefix+":tcp:rl", cfg.RedisFailClosed)
	tcpIPConnLimiter = newRedisConnLimiter(redisClient, cfg.TCPMaxConnsPerIP, cfg.RedisKeyPrefix+":tcp:conn:ip", cfg.RedisFailClosed)
	tcpTokenConnLimiter = newRedisConnLimiter(redisClient, cfg.TCPMaxConnsPerToken, cfg.RedisKeyPrefix+":tcp:conn:token", cfg.RedisFailClosed)
	tcpGlobalConnLimiter = newRedisConnLimiter(redisClient, cfg.TCPMaxConns, cfg.RedisKeyPrefix+":tcp:conn:global", cfg.RedisFailClosed)
	return nil
}

func (rl *localRateLimiter) Allow(ctx context.Context, ip string) bool {
	if ip == "" {
		return true
	}

	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	last, ok := rl.last[ip]
	if !ok {
		rl.last[ip] = now
		rl.tokens[ip] = rl.burst - 1
		return true
	}

	dt := now.Sub(last).Seconds()
	newTokens := rl.tokens[ip] + dt*rl.rate
	if newTokens > rl.burst {
		newTokens = rl.burst
	}
	if newTokens < 1 {
		rl.tokens[ip] = newTokens
		rl.last[ip] = now
		return false
	}

	rl.tokens[ip] = newTokens - 1
	rl.last[ip] = now

	if now.Sub(last) > 10*time.Minute {
		delete(rl.tokens, ip)
		delete(rl.last, ip)
	}

	return true
}

func parseRemoteIP(addr string) string {
	if addr == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return ""
	}
	return host
}

func buildRateLimitKey(token string, ip string) string {
	if token != "" && ip != "" {
		return "tok:" + token + ":ip:" + ip
	}
	if token != "" {
		return "tok:" + token
	}
	return ip
}

type ipConnLimiter struct {
	mu    sync.Mutex
	max   int
	count map[string]int
}

func newIPConnLimiter(max int) *ipConnLimiter {
	return &ipConnLimiter{
		max:   max,
		count: make(map[string]int),
	}
}

func (l *ipConnLimiter) acquire(ip string) bool {
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

func (l *ipConnLimiter) release(ip string) {
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

func (l *ipConnLimiter) Acquire(ctx context.Context, ip string) bool {
	return l.acquire(ip)
}

func (l *ipConnLimiter) Release(ctx context.Context, ip string) {
	l.release(ip)
}

type connLimiter interface {
	Acquire(ctx context.Context, key string) bool
	Release(ctx context.Context, key string)
}

type gatewayConfig struct {
	HTTPRate         float64
	HTTPBurst        int
	HTTPMaxBodyBytes int64
	TCPRate          float64
	TCPBurst         int
	TCPMaxConns      int
	TCPMaxConnsPerIP int
	TCPMaxConnsPerToken int
	RedisAddr        string
	RedisPassword    string
	RedisDB          int
	RedisKeyPrefix   string
	RedisPoolSize    int
	RedisMinIdle     int
	RedisFailClosed  bool
}

func loadConfig() gatewayConfig {
	return gatewayConfig{
		HTTPRate:         envFloat("HTTP_RATE", 150),
		HTTPBurst:        envInt("HTTP_BURST", 300),
		HTTPMaxBodyBytes: envInt64("HTTP_MAX_BODY_BYTES", 10<<20),
		TCPRate:          envFloat("TCP_RATE", 5),
		TCPBurst:         envInt("TCP_BURST", 15),
		TCPMaxConns:      envInt("TCP_MAX_CONNS", 4000),
		TCPMaxConnsPerIP: envInt("TCP_MAX_CONNS_PER_IP", 500),
		TCPMaxConnsPerToken: envInt("TCP_MAX_CONNS_PER_TOKEN", 15),
		RedisAddr:        os.Getenv("REDIS_ADDR"),
		RedisPassword:    os.Getenv("REDIS_PASSWORD"),
		RedisDB:          envInt("REDIS_DB", 0),
		RedisKeyPrefix:   envString("REDIS_KEY_PREFIX", "fctf:gateway"),
		RedisPoolSize:    envInt("REDIS_POOL_SIZE", 100),
		RedisMinIdle:     envInt("REDIS_MIN_IDLE", 10),
		RedisFailClosed:  envBool("REDIS_FAIL_CLOSED", false),
	}
}

func envInt(key string, def int) int {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	parsed, err := strconv.Atoi(val)
	if err != nil {
		return def
	}
	if parsed < 1 {
		return def
	}
	return parsed
}

func envInt64(key string, def int64) int64 {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	parsed, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return def
	}
	if parsed < 1 {
		return def
	}
	return parsed
}

func envFloat(key string, def float64) float64 {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	parsed, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return def
	}
	if parsed <= 0 {
		return def
	}
	return parsed
}

func envString(key string, def string) string {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	return val
}

func envBool(key string, def bool) bool {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	parsed, err := strconv.ParseBool(val)
	if err != nil {
		return def
	}
	return parsed
}