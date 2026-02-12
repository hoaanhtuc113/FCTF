package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"strconv"
	"sync"
)

type rateLimiter interface {
	Allow(ctx context.Context, key string) bool
}

func initLimiters(cfg gatewayConfig, redisClient redisLimiterClient) error {
	if redisClient == nil {
		httpRateLimiter = nil
		httpIPRateLimiter = nil
		tcpRateLimiter = nil
		tcpIPConnLimiter = nil
		tcpTokenConnLimiter = nil
		tcpGlobalConnLimiter = nil
		return fmt.Errorf("redis limiter required: REDIS_ADDR is missing or Redis unavailable")
	}

	httpRateLimiter = newRedisRateLimiter(redisClient, cfg.HTTPRate, cfg.HTTPBurst, cfg.RedisKeyPrefix+":http:rl", cfg.RedisFailClosed)
	httpIPRateLimiter = newRedisRateLimiter(redisClient, cfg.HTTPIPRate, cfg.HTTPIPBurst, cfg.RedisKeyPrefix+":http:rl:ip", cfg.RedisFailClosed)
	tcpRateLimiter = newRedisRateLimiter(redisClient, cfg.TCPRate, cfg.TCPBurst, cfg.RedisKeyPrefix+":tcp:rl", cfg.RedisFailClosed)
	tcpIPConnLimiter = newRedisConnLimiter(redisClient, cfg.TCPMaxConnsPerIP, cfg.RedisKeyPrefix+":tcp:conn:ip", cfg.TCPConnTTLSeconds, cfg.RedisFailClosed)
	tcpTokenConnLimiter = newRedisConnLimiter(redisClient, cfg.TCPMaxConnsPerToken, cfg.RedisKeyPrefix+":tcp:conn:token", cfg.TCPConnTTLSeconds, cfg.RedisFailClosed)
	tcpGlobalConnLimiter = newRedisConnLimiter(redisClient, cfg.TCPMaxConns, cfg.RedisKeyPrefix+":tcp:conn:global", cfg.TCPConnTTLSeconds, cfg.RedisFailClosed)
	return nil
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
	hashedToken := hashToken(token)
	if hashedToken != "" && ip != "" {
		return "tok:" + hashedToken + ":ip:" + ip
	}
	if hashedToken != "" {
		return "tok:" + hashedToken
	}
	return ip
}

func hashToken(token string) string {
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:16])
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
	HTTPIPRate       float64
	HTTPIPBurst      int
	HTTPMaxBodyBytes int64
	TCPRate          float64
	TCPBurst         int
	TCPCopyBufBytes  int
	TCPMaxConns      int
	TCPMaxConnsPerIP int
	TCPMaxConnsPerToken int
	TCPAuthTimeoutSeconds int
	TCPConnTTLSeconds int
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
		HTTPRate:         envFloat("HTTP_RATE", 300),
		HTTPBurst:        envInt("HTTP_BURST", 600),
		// Per-IP HTTP defaults increased to accommodate teams on same network
		HTTPIPRate:       envFloat("HTTP_IP_RATE", 500),
		HTTPIPBurst:      envInt("HTTP_IP_BURST", 1000),
		HTTPMaxBodyBytes: envInt64("HTTP_MAX_BODY_BYTES", 10<<20),
		TCPRate:          envFloat("TCP_RATE", 10),
		TCPBurst:         envInt("TCP_BURST", 30),
		TCPCopyBufBytes:  envInt("TCP_COPY_BUF_BYTES", 32*1024),
		TCPMaxConns:      envInt("TCP_MAX_CONNS", 4000),
		TCPMaxConnsPerIP: envInt("TCP_MAX_CONNS_PER_IP", 1000),
		TCPMaxConnsPerToken: envInt("TCP_MAX_CONNS_PER_TOKEN", 15),
		TCPAuthTimeoutSeconds: envInt("TCP_AUTH_TIMEOUT_SECONDS", 5),
		TCPConnTTLSeconds: envInt("TCP_CONN_TTL_SECONDS", 300),
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