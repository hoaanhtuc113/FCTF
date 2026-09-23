package requestlog

// A deliberately small S3-compatible client. The gateway only needs PutObject,
// so depending on a full SDK would give this write-only workload read/list/delete
// surface that it must never use. Signature V4 keeps it compatible with MinIO,
// AWS S3 and other S3-compatible endpoints.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

type S3Config struct {
	Endpoint        string
	Bucket          string
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
	PathStyle       bool
	SSE             string
	KMSKeyID        string
	HTTPClient      *http.Client
}

type S3ObjectStore struct {
	endpoint  *url.URL
	bucket    string
	region    string
	access    string
	secret    string
	token     string
	pathStyle bool
	sse       string
	kmsKeyID  string
	client    *http.Client
}

func NewS3ObjectStore(cfg S3Config) (*S3ObjectStore, error) {
	endpoint, err := url.Parse(strings.TrimSpace(cfg.Endpoint))
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, fmt.Errorf("REQUEST_LOG_S3_ENDPOINT must be an absolute URL")
	}
	if endpoint.Scheme != "https" {
		return nil, fmt.Errorf("REQUEST_LOG_S3_ENDPOINT must use https")
	}
	if !safeBucket(cfg.Bucket) || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
		return nil, fmt.Errorf("request-log S3 bucket and credentials are required")
	}
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	sse := strings.TrimSpace(cfg.SSE)
	if sse == "" {
		sse = "AES256"
	}
	if sse != "AES256" && sse != "aws:kms" {
		return nil, fmt.Errorf("REQUEST_LOG_S3_SSE must be AES256 or aws:kms")
	}
	if sse == "aws:kms" && strings.TrimSpace(cfg.KMSKeyID) == "" {
		return nil, fmt.Errorf("REQUEST_LOG_S3_KMS_KEY_ID is required when REQUEST_LOG_S3_SSE=aws:kms")
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &S3ObjectStore{
		endpoint: endpoint, bucket: cfg.Bucket, region: cfg.Region,
		access: cfg.AccessKeyID, secret: cfg.SecretAccessKey, token: cfg.SessionToken,
		pathStyle: cfg.PathStyle, sse: sse, kmsKeyID: cfg.KMSKeyID, client: client,
	}, nil
}

func (s *S3ObjectStore) Put(ctx context.Context, key string, r io.Reader) error {
	if s == nil || s.endpoint == nil || !validObjectKey(key) {
		return ErrUnavailable
	}
	u := s.objectURL(key)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), r)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/gzip")
	// The worker gives us a spool file. A concrete length avoids chunked PUT,
	// which is rejected by several otherwise S3-compatible appliances.
	if seeker, ok := r.(io.Seeker); ok {
		if current, seekErr := seeker.Seek(0, io.SeekCurrent); seekErr == nil {
			if end, endErr := seeker.Seek(0, io.SeekEnd); endErr == nil {
				req.ContentLength = end - current
				_, _ = seeker.Seek(current, io.SeekStart)
			}
		}
	}
	req.Header.Set("x-amz-content-sha256", "UNSIGNED-PAYLOAD")
	req.Header.Set("x-amz-server-side-encryption", s.sse)
	if s.kmsKeyID != "" {
		req.Header.Set("x-amz-server-side-encryption-aws-kms-key-id", s.kmsKeyID)
	}
	if s.token != "" {
		req.Header.Set("x-amz-security-token", s.token)
	}
	if err := s.sign(req); err != nil {
		return err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("request-log S3 PutObject status %d", resp.StatusCode)
	}
	return nil
}

// The Gateway identity is intentionally write-only. Keeping these interface
// methods denied makes accidental future read/list call sites fail closed.
func (*S3ObjectStore) Get(context.Context, string) (io.ReadCloser, error) { return nil, ErrUnavailable }
func (*S3ObjectStore) Exists(context.Context, string) (bool, error)       { return false, ErrUnavailable }

func (s *S3ObjectStore) objectURL(key string) *url.URL {
	u := *s.endpoint
	basePath := strings.TrimRight(u.Path, "/")
	baseRawPath := strings.TrimRight(u.EscapedPath(), "/")
	if s.pathStyle {
		u.Path = basePath + "/" + s.bucket + "/" + key
		u.RawPath = baseRawPath + "/" + url.PathEscape(s.bucket) + "/" + escapeObjectKey(key)
		return &u
	}
	u.Host = s.bucket + "." + u.Host
	u.Path = basePath + "/" + key
	u.RawPath = baseRawPath + "/" + escapeObjectKey(key)
	return &u
}

func (s *S3ObjectStore) sign(req *http.Request) error {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	shortDate := now.Format("20060102")
	req.Header.Set("x-amz-date", amzDate)

	headers := map[string]string{"host": req.URL.Host}
	for name, values := range req.Header {
		headers[strings.ToLower(name)] = strings.Join(values, ",")
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	var canonicalHeaders strings.Builder
	for _, name := range names {
		canonicalHeaders.WriteString(name)
		canonicalHeaders.WriteByte(':')
		canonicalHeaders.WriteString(strings.Join(strings.Fields(headers[name]), " "))
		canonicalHeaders.WriteByte('\n')
	}
	signedHeaders := strings.Join(names, ";")
	payloadHash := req.Header.Get("x-amz-content-sha256")
	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		canonicalQuery(req.URL),
		canonicalHeaders.String(),
		signedHeaders,
		payloadHash,
	}, "\n")
	scope := shortDate + "/" + s.region + "/s3/aws4_request"
	requestHash := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(requestHash[:])
	signingKey := hmacSHA256([]byte("AWS4"+s.secret), shortDate)
	signingKey = hmacSHA256(signingKey, s.region)
	signingKey = hmacSHA256(signingKey, "s3")
	signingKey = hmacSHA256(signingKey, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+s.access+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
	return nil
}

func canonicalQuery(u *url.URL) string {
	if u.RawQuery == "" {
		return ""
	}
	values := u.Query()
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		vals := append([]string(nil), values[key]...)
		sort.Strings(vals)
		for _, value := range vals {
			parts = append(parts, awsEscape(key)+"="+awsEscape(value))
		}
	}
	return strings.Join(parts, "&")
}

func hmacSHA256(key []byte, message string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write([]byte(message))
	return h.Sum(nil)
}

func escapeObjectKey(key string) string {
	parts := strings.Split(key, "/")
	for i := range parts {
		parts[i] = awsEscape(parts[i])
	}
	return strings.Join(parts, "/")
}

func awsEscape(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func validObjectKey(key string) bool {
	return strings.HasPrefix(key, "request-logs/") && !strings.Contains(key, "..") && len(key) <= 1024
}

func safeBucket(bucket string) bool {
	if len(bucket) < 3 || len(bucket) > 63 || strings.HasPrefix(bucket, ".") || strings.HasSuffix(bucket, ".") {
		return false
	}
	for _, r := range bucket {
		if !(r == '.' || r == '-' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return !strings.Contains(bucket, "..")
}
