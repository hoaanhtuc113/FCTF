package main

import (
	"net"
	"os"
	"strconv"
	"sync"
	"time"
)

type rateLimiter struct {
	mu     sync.Mutex
	rate   float64
	burst  float64
	tokens map[string]float64
	last   map[string]time.Time
}

func newRateLimiter(rate float64, burst int) *rateLimiter {
	return &rateLimiter{
		rate:   rate,
		burst:  float64(burst),
		tokens: make(map[string]float64),
		last:   make(map[string]time.Time),
	}
}

func initLimiters(cfg gatewayConfig) {
	httpRateLimiter = newRateLimiter(cfg.HTTPRate, cfg.HTTPBurst)
	tcpRateLimiter = newRateLimiter(cfg.TCPRate, cfg.TCPBurst)
	tcpIPConnLimiter = newIPConnLimiter(cfg.TCPMaxConnsPerIP)
}

func (rl *rateLimiter) Allow(ip string) bool {
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

type gatewayConfig struct {
	HTTPRate         float64
	HTTPBurst        int
	TCPRate          float64
	TCPBurst         int
	TCPMaxConns      int
	TCPMaxConnsPerIP int
}

func loadConfig() gatewayConfig {
	return gatewayConfig{
		HTTPRate:         envFloat("HTTP_RATE", 100),
		HTTPBurst:        envInt("HTTP_BURST", 200),
		TCPRate:          envFloat("TCP_RATE", 50),
		TCPBurst:         envInt("TCP_BURST", 200),
		TCPMaxConns:      envInt("TCP_MAX_CONNS", 4000),
		TCPMaxConnsPerIP: envInt("TCP_MAX_CONNS_PER_IP", 80),
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