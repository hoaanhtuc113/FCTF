// Package telemetry emits the Gateway's versioned, metadata-only access events.
package telemetry

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const SchemaVersion = 1

// Event is deliberately flat JSON Lines. Values that could create a
// high-cardinality Loki stream remain JSON fields, never labels.
type Event struct {
	SchemaVersion     int    `json:"schema_version"`
	EventID           string `json:"event_id"`
	OccurredAt        string `json:"occurred_at"`
	Event             string `json:"event"`
	Protocol          string `json:"protocol"`
	InstanceID        string `json:"instance_id,omitempty"`
	InstanceNamespace string `json:"instance_namespace,omitempty"`
	ContestID         *int   `json:"contest_id,omitempty"`
	ChallengeID       *int   `json:"challenge_id,omitempty"`
	ActorUserRef      string `json:"actor_user_ref,omitempty"`
	ActorTeamID       *int   `json:"actor_team_id,omitempty"`
	PeerIP            string `json:"peer_ip,omitempty"`
	IPSource          string `json:"ip_source,omitempty"`
	Method            string `json:"method,omitempty"`
	Path              string `json:"path,omitempty"`
	Status            *int   `json:"status,omitempty"`
	RequestBytes      int64  `json:"request_bytes,omitempty"`
	ResponseBytes     int64  `json:"response_bytes,omitempty"`
	BytesC2S          int64  `json:"bytes_c2s,omitempty"`
	BytesS2C          int64  `json:"bytes_s2c,omitempty"`
	DurationMS        int64  `json:"duration_ms,omitempty"`
	Outcome           string `json:"outcome,omitempty"`
	TerminationReason string `json:"termination_reason,omitempty"`
	AuthStrength      string `json:"auth_strength,omitempty"`
	ErrorCode         string `json:"error_code,omitempty"`
	DataClass         string `json:"data_class"`
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

// Emit must be best effort: failed logging cannot interrupt challenge traffic.
func Emit(event Event) {
	encoded, err := json.Marshal(event)
	if err != nil {
		fmt.Printf(`{"schema_version":1,"event_id":"%s","occurred_at":"%s","event":"telemetry_encode_failed","protocol":"internal","data_class":"metadata"}`+"\n",
			newUUIDv7(), time.Now().UTC().Format(time.RFC3339Nano))
		return
	}
	// This is intentionally a bare JSON line. The default Go logger prepends a
	// timestamp, which would turn an otherwise valid event into unparseable text
	// before it reaches Loki.
	fmt.Println(string(encoded))
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
