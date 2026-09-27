// Package telemetry emits the Gateway's versioned, metadata-only access events.
package telemetry

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

const SchemaVersion = 1

var (
	emittedTotal                   atomic.Uint64
	encodeFailuresTotal            atomic.Uint64
	writeFailuresTotal             atomic.Uint64
	captureQueuedTotal             atomic.Uint64
	captureDroppedTotal            atomic.Uint64
	captureSkippedPolicyTotal      atomic.Uint64
	captureUploadErrorTotal        atomic.Uint64
	captureUploadSuccessTotal      atomic.Uint64
	captureUploadRetryTotal        atomic.Uint64
	captureUploadMillisecondsTotal atomic.Uint64
	captureQueueDepth              atomic.Int64
	captureSpoolBytes              atomic.Int64
)

// Event is deliberately flat JSON Lines. Values that could create a
// high-cardinality Loki stream remain JSON fields, never labels.
type Event struct {
	SchemaVersion        int    `json:"schema_version"`
	EventID              string `json:"event_id"`
	OccurredAt           string `json:"occurred_at"`
	Event                string `json:"event"`
	Protocol             string `json:"protocol"`
	SessionID            string `json:"session_id,omitempty"`
	InstanceID           string `json:"instance_id,omitempty"`
	InstanceNamespace    string `json:"instance_namespace,omitempty"`
	ContestID            *int   `json:"contest_id,omitempty"`
	ChallengeID          *int   `json:"challenge_id,omitempty"`
	ActorUserRef         string `json:"actor_user_ref,omitempty"`
	ActorTeamID          *int   `json:"actor_team_id,omitempty"`
	PeerIP               string `json:"peer_ip,omitempty"`
	IPSource             string `json:"ip_source,omitempty"`
	Method               string `json:"method,omitempty"`
	Path                 string `json:"path,omitempty"`
	Status               *int   `json:"status,omitempty"`
	RequestBytes         int64  `json:"request_bytes,omitempty"`
	ResponseBytes        int64  `json:"response_bytes,omitempty"`
	BytesC2S             int64  `json:"bytes_c2s,omitempty"`
	BytesS2C             int64  `json:"bytes_s2c,omitempty"`
	DurationMS           int64  `json:"duration_ms,omitempty"`
	Outcome              string `json:"outcome,omitempty"`
	TerminationReason    string `json:"termination_reason,omitempty"`
	AuthStrength         string `json:"auth_strength,omitempty"`
	ErrorCode            string `json:"error_code,omitempty"`
	ContentSchemaVersion int    `json:"content_schema_version,omitempty"`
	CaptureProfile       string `json:"capture_profile,omitempty"`
	CaptureSubmission    string `json:"capture_submission,omitempty"`
	DataClass            string `json:"data_class"`
}

func New(event, protocol string) Event {
	return Event{
		SchemaVersion: SchemaVersion,
		EventID:       newUUIDv7(),
		OccurredAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Event:         event,
		Protocol:      protocol,
		DataClass:     "metadata",
	}
}

// NewSessionID creates a correlation identifier for one accepted TCP socket.
// It is an event field, never a Loki label or an authorization credential.
func NewSessionID() string { return newUUIDv7() }

// Emit must be best effort: failed logging cannot interrupt challenge traffic.
func Emit(event Event) {
	encoded, err := json.Marshal(event)
	if err != nil {
		encodeFailuresTotal.Add(1)
		fallback := `{"schema_version":1,"event_id":"` + newUUIDv7() + `","occurred_at":"` + time.Now().UTC().Format(time.RFC3339Nano) + `","event":"telemetry_encode_failed","protocol":"internal","data_class":"metadata"}` + "\n"
		if _, writeErr := os.Stdout.WriteString(fallback); writeErr != nil {
			writeFailuresTotal.Add(1)
		}
		return
	}
	// This is intentionally a bare JSON line. The default Go logger prepends a
	// timestamp, which would turn an otherwise valid event into unparseable text
	// before it reaches Loki.
	line := append(encoded, '\n')
	if _, err := os.Stdout.Write(line); err != nil {
		writeFailuresTotal.Add(1)
		return
	}
	emittedTotal.Add(1)
}

// MetricsHandler exports only pipeline-health counters. It deliberately does
// not expose request paths, identities, tokens, or any other event data.
// A successful stdout write is the last delivery point visible to the Gateway;
// collector-to-Loki delivery must be monitored by the collector separately.
func MetricsHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte("# HELP challenge_gateway_telemetry_emitted_total Metadata events written to stdout.\n"))
	_, _ = w.Write([]byte("# TYPE challenge_gateway_telemetry_emitted_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_telemetry_emitted_total " + formatUint(emittedTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_telemetry_encode_failures_total Metadata events that could not be JSON encoded.\n"))
	_, _ = w.Write([]byte("# TYPE challenge_gateway_telemetry_encode_failures_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_telemetry_encode_failures_total " + formatUint(encodeFailuresTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_telemetry_write_failures_total Metadata events that could not be written to stdout.\n"))
	_, _ = w.Write([]byte("# TYPE challenge_gateway_telemetry_write_failures_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_telemetry_write_failures_total " + formatUint(writeFailuresTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_queued_total Bounded request bodies queued for object storage.\n# TYPE challenge_gateway_request_log_capture_queued_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_queued_total " + formatUint(captureQueuedTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_dropped_total Bounded captures dropped because capture storage was disabled or full.\n# TYPE challenge_gateway_request_log_capture_dropped_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_dropped_total " + formatUint(captureDroppedTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_upload_errors_total Bounded capture uploads that failed.\n# TYPE challenge_gateway_request_log_capture_upload_errors_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_upload_errors_total " + formatUint(captureUploadErrorTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_skipped_by_policy_total Captures skipped by feature, quota or streaming policy.\n# TYPE challenge_gateway_request_log_capture_skipped_by_policy_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_skipped_by_policy_total " + formatUint(captureSkippedPolicyTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_upload_success_total Captures successfully persisted to object storage.\n# TYPE challenge_gateway_request_log_capture_upload_success_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_upload_success_total " + formatUint(captureUploadSuccessTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_upload_retries_total Object-store upload retries.\n# TYPE challenge_gateway_request_log_capture_upload_retries_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_upload_retries_total " + formatUint(captureUploadRetryTotal.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_queue_depth Current bounded capture queue depth.\n# TYPE challenge_gateway_request_log_capture_queue_depth gauge\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_queue_depth " + formatInt(captureQueueDepth.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_spool_bytes Current local bounded upload spool bytes.\n# TYPE challenge_gateway_request_log_capture_spool_bytes gauge\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_spool_bytes " + formatInt(captureSpoolBytes.Load()) + "\n"))
	_, _ = w.Write([]byte("# HELP challenge_gateway_request_log_capture_upload_duration_milliseconds_total Total successful capture upload latency.\n# TYPE challenge_gateway_request_log_capture_upload_duration_milliseconds_total counter\n"))
	_, _ = w.Write([]byte("challenge_gateway_request_log_capture_upload_duration_milliseconds_total " + formatUint(captureUploadMillisecondsTotal.Load()) + "\n"))
}

func ObserveCaptureSubmission(submission string) {
	if submission == "queued" {
		captureQueuedTotal.Add(1)
	} else if submission == "dropped" {
		captureDroppedTotal.Add(1)
	} else if submission == "skipped_by_policy" {
		captureSkippedPolicyTotal.Add(1)
	}
}

func ObserveCaptureUploadError()   { captureUploadErrorTotal.Add(1) }
func ObserveCaptureDropped()       { captureDroppedTotal.Add(1) }
func ObserveCaptureUploadSuccess() { captureUploadSuccessTotal.Add(1) }
func ObserveCaptureUploadRetry()   { captureUploadRetryTotal.Add(1) }
func ObserveCaptureUploadLatency(d time.Duration) {
	if d > 0 {
		captureUploadMillisecondsTotal.Add(uint64(d.Milliseconds()))
	}
}
func SetCaptureQueueDepth(value int)   { captureQueueDepth.Store(int64(value)) }
func SetCaptureSpoolBytes(value int64) { captureSpoolBytes.Store(value) }

func formatUint(value uint64) string {
	const digits = "0123456789"
	if value == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = digits[value%10]
		value /= 10
	}
	return string(buf[i:])
}

func formatInt(value int64) string {
	if value < 0 {
		return "0"
	}
	return formatUint(uint64(value))
}

// SanitizePath omits query values and strips controls before an event reaches a
// log collector or an admin text view.
func SanitizePath(path string) string {
	if path == "" {
		return "/"
	}
	var b strings.Builder
	b.Grow(min(len(path), 2048))
	for _, r := range path {
		if r < 0x20 || r == 0x7f {
			b.WriteRune('_')
			continue
		}
		b.WriteRune(r)
		if b.Len() >= 2048 {
			break
		}
	}
	if b.Len() == 0 {
		return "/"
	}
	return b.String()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// UUIDv7 keeps event IDs time ordered without exposing request content. Go 1.22
// does not provide one in the standard library, so the 48-bit Unix millisecond
// timestamp and RFC 9562 version/variant bits are assembled locally.
func newUUIDv7() string {
	var raw [16]byte
	_, _ = rand.Read(raw[:])
	ms := uint64(time.Now().UnixMilli())
	raw[0] = byte(ms >> 40)
	raw[1] = byte(ms >> 32)
	raw[2] = byte(ms >> 24)
	raw[3] = byte(ms >> 16)
	raw[4] = byte(ms >> 8)
	raw[5] = byte(ms)
	raw[6] = (raw[6] & 0x0f) | 0x70
	raw[8] = (raw[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(raw[:])
	return hexValue[0:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:]
}
