package requestlog

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

// Buffer retains at most limit bytes while counting and hashing all bytes read.
// It is intentionally safe to use on an untrusted request body.
type Buffer struct {
	limit     int
	data      []byte
	original  int64
	truncated bool
}

func NewBuffer(limit int) *Buffer {
	if limit < 0 {
		limit = 0
	}
	return &Buffer{limit: limit}
}

func (b *Buffer) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	b.original += int64(len(p))
	remaining := b.limit - len(b.data)
	if remaining > 0 {
		n := len(p)
		if n > remaining {
			n = remaining
		}
		b.data = append(b.data, p[:n]...)
	}
	if len(p) > remaining {
		b.truncated = true
	}
	return len(p), nil
}

func (b *Buffer) Part() Part {
	return makePart(b.original, b.data, b.truncated)
}

// SanitizedPart returns the exact body persisted to object storage. Form and
// JSON fields with credential-like names are redacted before Base64 encoding;
// opaque formats remain bounded raw bytes because generic parsing would create
// more risk than it removes. This is defence-in-depth, not a claim that every
// secret embedded in arbitrary binary/text can be detected.
func (b *Buffer) SanitizedPart(contentType string) Part {
	data := b.Bytes()
	var redactionFailed bool
	data, redactionFailed = redactBody(data, contentType)
	truncated := b.truncated || redactionFailed || len(data) > b.limit
	if len(data) > b.limit {
		data = data[:b.limit]
	}
	return makePart(b.original, data, truncated)
}

func makePart(original int64, data []byte, truncated bool) Part {
	part := Part{
		OriginalSize: original,
		CapturedSize: len(data),
		Truncated:    truncated,
	}
	if len(data) > 0 {
		part.BodyBase64 = base64.StdEncoding.EncodeToString(data)
		sum := sha256.Sum256(data)
		part.CapturedSHA256 = hex.EncodeToString(sum[:])
	}
	return part
}

func (b *Buffer) Bytes() []byte { return append([]byte(nil), b.data...) }

func SanitizeHeaders(headers http.Header) map[string][]string {
	return SanitizeHeadersLimited(headers, 64<<10)
}

func SanitizeHeadersLimited(headers http.Header, limit int) map[string][]string {
	if limit < 0 {
		limit = 0
	}
	out := make(map[string][]string, len(headers))
	used := 0
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		values := headers[name]
		canonical := http.CanonicalHeaderKey(name)
		if sensitiveHeader(canonical) {
			if used+len(canonical)+len("[REDACTED]") > limit {
				continue
			}
			out[canonical] = []string{"[REDACTED]"}
			used += len(canonical) + len("[REDACTED]")
			continue
		}
		for _, value := range values {
			cost := len(value)
			if len(out[canonical]) == 0 {
				cost += len(canonical)
			}
			if used+cost > limit {
				break
			}
			out[canonical] = append(out[canonical], value)
			used += cost
		}
	}
	return out
}

func Parameters(values url.Values) []Parameter {
	return ParametersLimited(values, 64<<10)
}

func ParametersLimited(values url.Values, limit int) []Parameter {
	if limit < 0 {
		limit = 0
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]Parameter, 0, len(keys))
	used := 0
	for _, key := range keys {
		if used+len(key) > limit {
			continue
		}
		vals := append([]string(nil), values[key]...)
		if sensitiveParameter(key) {
			vals = []string{"[REDACTED]"}
		}
		kept := make([]string, 0, len(vals))
		for _, value := range vals {
			if used+len(key)+len(value) > limit {
				break
			}
			kept = append(kept, value)
			used += len(key) + len(value)
		}
		if len(kept) > 0 {
			out = append(out, Parameter{Name: key, Values: kept})
		}
	}
	return out
}

func sensitiveHeader(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return n == "authorization" || n == "proxy-authorization" || n == "cookie" || n == "set-cookie" || strings.Contains(n, "fctf") || strings.Contains(n, "token") || strings.Contains(n, "secret") || strings.Contains(n, "password") || strings.Contains(n, "passwd") || strings.Contains(n, "pwd") || strings.Contains(n, "api-key") || strings.Contains(n, "api_key")
}

func sensitiveParameter(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return n == "authorization" || strings.Contains(n, "fctf") || strings.Contains(n, "token") || strings.Contains(n, "secret") || strings.Contains(n, "password") || strings.Contains(n, "passwd") || strings.Contains(n, "pwd") || strings.Contains(n, "cookie") || strings.Contains(n, "api_key") || strings.Contains(n, "api-key")
}

func redactBody(data []byte, contentType string) ([]byte, bool) {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if strings.HasSuffix(contentType, "+json") {
		contentType = "application/json"
	}
	switch contentType {
	case "application/x-www-form-urlencoded":
		values, err := url.ParseQuery(string(data))
		if err != nil {
			return nil, true
		}
		for key := range values {
			if sensitiveParameter(key) {
				values[key] = []string{"[REDACTED]"}
			}
		}
		return []byte(values.Encode()), false
	case "application/json", "text/json":
		var value any
		if err := json.Unmarshal(data, &value); err != nil {
			return nil, true
		}
		redactJSON(value)
		result, err := json.Marshal(value)
		if err != nil {
			return nil, true
		}
		return result, false
	default:
		return data, false
	}
}

func redactJSON(value any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if sensitiveParameter(key) || strings.EqualFold(key, "authorization") {
				typed[key] = "[REDACTED]"
				continue
			}
			redactJSON(child)
		}
	case []any:
		for _, child := range typed {
			redactJSON(child)
		}
	}
}
