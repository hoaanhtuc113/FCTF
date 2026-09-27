package config

import (
	"os"
	"strconv"
)

// Config holds all runtime configuration for the gateway.
type Config struct {
	HTTPRate                 float64
	HTTPBurst                int
	HTTPIPRate               float64
	HTTPIPBurst              int
	HTTPMaxBodyBytes         int64
	AppEnv                   string
	RequestLogCaptureEnabled bool
	RequestLogObjectDir      string
	RequestLogSpoolDir       string
	RequestLogQueueSize      int
	RequestLogRetryAttempts  int
	RequestLogWorkerCount    int
	RequestLogSpoolMaxBytes  int64
	RequestLogHeaderCapBytes int
	RequestLogBodyCapBytes   int
	RequestLogQuotaBytes     int64
	RequestLogQuotaWindowSec int
	RequestLogS3Endpoint     string
	RequestLogS3Bucket       string
	RequestLogS3Region       string
	RequestLogS3AccessKey    string
	RequestLogS3SecretKey    string
	RequestLogS3SessionToken string
	RequestLogS3PathStyle    bool
	RequestLogS3SSE          string
	RequestLogS3KMSKeyID     string
	GatewayTLSCertFile       string
	GatewayTLSKeyFile        string
	TCPRate                  float64
	TCPBurst                 int
	TCPCopyBufBytes          int
	TCPMaxConns              int
	TCPMaxConnsPerIP         int
	TCPMaxConnsPerToken      int
	TCPAuthTimeoutSeconds    int
	TCPConnTTLSeconds        int
	RedisAddr                string
	RedisUsername            string
	RedisPassword            string
	RedisDB                  int
	RedisKeyPrefix           string
	RedisPoolSize            int
	RedisMinIdle             int
	RedisFailClosed          bool
	RedisTLS                 bool
}

// Load reads configuration from environment variables, applying defaults where unset.
func Load() Config {
	return Config{
		HTTPRate:                 EnvFloat("HTTP_RATE", 300),
		HTTPBurst:                EnvInt("HTTP_BURST", 600),
		HTTPIPRate:               EnvFloat("HTTP_IP_RATE", 500),
		HTTPIPBurst:              EnvInt("HTTP_IP_BURST", 1000),
		HTTPMaxBodyBytes:         EnvInt64("HTTP_MAX_BODY_BYTES", 10<<20),
		AppEnv:                   EnvString("APP_ENV", "development"),
		RequestLogCaptureEnabled: EnvBool("REQUEST_LOG_CAPTURE_ENABLED", false),
		RequestLogObjectDir:      os.Getenv("REQUEST_LOG_OBJECT_DIR"),
		RequestLogSpoolDir:       os.Getenv("REQUEST_LOG_SPOOL_DIR"),
		RequestLogQueueSize:      EnvIntMax("REQUEST_LOG_QUEUE_SIZE", 128, 4096),
		RequestLogRetryAttempts:  EnvIntMax("REQUEST_LOG_RETRY_ATTEMPTS", 3, 10),
		RequestLogWorkerCount:    EnvIntMax("REQUEST_LOG_WORKER_COUNT", 1, 32),
		RequestLogSpoolMaxBytes:  EnvInt64Max("REQUEST_LOG_SPOOL_MAX_BYTES", 256<<20, 4<<30),
		RequestLogHeaderCapBytes: EnvIntMax("REQUEST_LOG_HEADER_CAP_BYTES", 64<<10, 1<<20),
		RequestLogBodyCapBytes:   EnvIntMax("REQUEST_LOG_BODY_CAP_BYTES", 256<<10, 2<<20),
		RequestLogQuotaBytes:     EnvInt64Max("REQUEST_LOG_QUOTA_BYTES", 512<<20, 16<<30),
		RequestLogQuotaWindowSec: EnvIntMax("REQUEST_LOG_QUOTA_WINDOW_SECONDS", 3600, 86400),
		RequestLogS3Endpoint:     os.Getenv("REQUEST_LOG_S3_ENDPOINT"),
		RequestLogS3Bucket:       os.Getenv("REQUEST_LOG_S3_BUCKET"),
		RequestLogS3Region:       EnvString("REQUEST_LOG_S3_REGION", "us-east-1"),
		RequestLogS3AccessKey:    os.Getenv("REQUEST_LOG_S3_ACCESS_KEY"),
		RequestLogS3SecretKey:    os.Getenv("REQUEST_LOG_S3_SECRET_KEY"),
		RequestLogS3SessionToken: os.Getenv("REQUEST_LOG_S3_SESSION_TOKEN"),
		RequestLogS3PathStyle:    EnvBool("REQUEST_LOG_S3_PATH_STYLE", true),
		RequestLogS3SSE:          EnvString("REQUEST_LOG_S3_SSE", "AES256"),
		RequestLogS3KMSKeyID:     os.Getenv("REQUEST_LOG_S3_KMS_KEY_ID"),
		GatewayTLSCertFile:       EnvString("GATEWAY_TLS_CERT_FILE", ""),
		GatewayTLSKeyFile:        EnvString("GATEWAY_TLS_KEY_FILE", ""),
		TCPRate:                  EnvFloat("TCP_RATE", 10),
		TCPBurst:                 EnvInt("TCP_BURST", 30),
		TCPCopyBufBytes:          EnvInt("TCP_COPY_BUF_BYTES", 32*1024),
		TCPMaxConns:              EnvInt("TCP_MAX_CONNS", 4000),
		TCPMaxConnsPerIP:         EnvInt("TCP_MAX_CONNS_PER_IP", 1000),
		TCPMaxConnsPerToken:      EnvInt("TCP_MAX_CONNS_PER_TOKEN", 15),
		TCPAuthTimeoutSeconds:    EnvInt("TCP_AUTH_TIMEOUT_SECONDS", 5),
		TCPConnTTLSeconds:        EnvInt("TCP_CONN_TTL_SECONDS", 300),
		RedisAddr:                os.Getenv("REDIS_ADDR"),
		RedisUsername:            os.Getenv("REDIS_USERNAME"),
		RedisPassword:            os.Getenv("REDIS_PASSWORD"),
		RedisDB:                  EnvInt("REDIS_DB", 0),
		RedisKeyPrefix:           EnvString("REDIS_KEY_PREFIX", "fctf:gateway"),
		RedisPoolSize:            EnvInt("REDIS_POOL_SIZE", 100),
		RedisMinIdle:             EnvInt("REDIS_MIN_IDLE", 10),
		RedisFailClosed:          EnvBool("REDIS_FAIL_CLOSED", false),
		RedisTLS:                 EnvBool("REDIS_TLS", false),
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

func EnvIntMax(key string, def, max int) int {
	value := EnvInt(key, def)
	if value > max {
		return max
	}
	return value
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

func EnvInt64Max(key string, def, max int64) int64 {
	value := EnvInt64(key, def)
	if value > max {
		return max
	}
	return value
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
