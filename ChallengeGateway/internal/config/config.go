package config

import (
	"os"
	"strconv"
)

// Config holds all runtime configuration for the gateway.
type Config struct {
	HTTPRate              float64
	HTTPBurst             int
	HTTPIPRate            float64
	HTTPIPBurst           int
	HTTPMaxBodyBytes      int64
	TCPRate               float64
	TCPBurst              int
	TCPCopyBufBytes       int
	TCPMaxConns           int
	TCPMaxConnsPerIP      int
	TCPMaxConnsPerToken   int
	TCPAuthTimeoutSeconds int
	TCPConnTTLSeconds     int
	RedisAddr             string
	RedisPassword         string
	RedisDB               int
	RedisKeyPrefix        string
	RedisPoolSize         int
	RedisMinIdle          int
	RedisFailClosed       bool
}

// Load reads configuration from environment variables, applying defaults where unset.
func Load() Config {
	return Config{
		HTTPRate:              EnvFloat("HTTP_RATE", 300),
		HTTPBurst:             EnvInt("HTTP_BURST", 600),
		HTTPIPRate:            EnvFloat("HTTP_IP_RATE", 500),
		HTTPIPBurst:           EnvInt("HTTP_IP_BURST", 1000),
		HTTPMaxBodyBytes:      EnvInt64("HTTP_MAX_BODY_BYTES", 10<<20),
		TCPRate:               EnvFloat("TCP_RATE", 10),
		TCPBurst:              EnvInt("TCP_BURST", 30),
		TCPCopyBufBytes:       EnvInt("TCP_COPY_BUF_BYTES", 32*1024),
		TCPMaxConns:           EnvInt("TCP_MAX_CONNS", 4000),
		TCPMaxConnsPerIP:      EnvInt("TCP_MAX_CONNS_PER_IP", 1000),
		TCPMaxConnsPerToken:   EnvInt("TCP_MAX_CONNS_PER_TOKEN", 15),
		TCPAuthTimeoutSeconds: EnvInt("TCP_AUTH_TIMEOUT_SECONDS", 5),
		TCPConnTTLSeconds:     EnvInt("TCP_CONN_TTL_SECONDS", 300),
		RedisAddr:             os.Getenv("REDIS_ADDR"),
		RedisPassword:         os.Getenv("REDIS_PASSWORD"),
		RedisDB:               EnvInt("REDIS_DB", 0),
		RedisKeyPrefix:        EnvString("REDIS_KEY_PREFIX", "fctf:gateway"),
		RedisPoolSize:         EnvInt("REDIS_POOL_SIZE", 100),
		RedisMinIdle:          EnvInt("REDIS_MIN_IDLE", 10),
		RedisFailClosed:       EnvBool("REDIS_FAIL_CLOSED", false),
	}
}

func EnvInt(key string, def int) int {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	parsed, err := strconv.Atoi(val)
	if err != nil || parsed < 1 {
		return def
	}
	return parsed
}

func EnvInt64(key string, def int64) int64 {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	parsed, err := strconv.ParseInt(val, 10, 64)
	if err != nil || parsed < 1 {
		return def
	}
	return parsed
}

func EnvFloat(key string, def float64) float64 {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	parsed, err := strconv.ParseFloat(val, 64)
	if err != nil || parsed <= 0 {
		return def
	}
	return parsed
}

func EnvString(key string, def string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return def
}

func EnvBool(key string, def bool) bool {
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
