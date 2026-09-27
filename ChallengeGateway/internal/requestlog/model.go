package requestlog

import "time"

// CaptureProfile is the capture policy attached to a request transaction.
// metadata is the safe default; bounded_content is opt-in and bounded.
type CaptureProfile string

const (
	ProfileMetadata       CaptureProfile = "metadata"
	ProfileBoundedContent CaptureProfile = "bounded_content"
)

type Submission string

const (
	// SubmissionNotRequested is emitted for the default metadata-only profile.
	SubmissionNotRequested Submission = "not_requested"
	SubmissionQueued       Submission = "queued"
	SubmissionDropped      Submission = "dropped"
	// SubmissionSkippedByPolicy includes a disabled kill-switch, unsupported
	// streaming response and a quota backend refusal. It must never reject the
	// participant request.
	SubmissionSkippedByPolicy Submission = "skipped_by_policy"
)

type Parameter struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

type Part struct {
	Headers      map[string][]string `json:"headers,omitempty"`
	QueryParams  []Parameter         `json:"query_params,omitempty"`
	FormParams   []Parameter         `json:"form_params,omitempty"`
	ContentType  string              `json:"content_type,omitempty"`
	Encoding     string              `json:"encoding,omitempty"`
	OriginalSize int64               `json:"original_size"`
	CapturedSize int                 `json:"captured_size"`
	Truncated    bool                `json:"truncated"`
	// CapturedSHA256 covers exactly body_base64 after decoding. Original bytes
	// are deliberately not retained after a cap is reached, so a digest of the
	// full original stream would be impossible for the reader to verify.
	CapturedSHA256 string `json:"captured_sha256,omitempty"`
	BodyBase64     string `json:"body_base64,omitempty"`
}

type Transaction struct {
	ContentSchemaVersion int            `json:"content_schema_version"`
	EventID              string         `json:"event_id"`
	InstanceNamespace    string         `json:"instance_namespace"`
	ChallengeID          *int           `json:"challenge_id,omitempty"`
	ActorTeamID          *int           `json:"actor_team_id,omitempty"`
	OccurredAt           time.Time      `json:"occurred_at"`
	CapturedAt           time.Time      `json:"captured_at"`
	CaptureProfile       CaptureProfile `json:"capture_profile"`
	Submission           Submission     `json:"submission"`
	Method               string         `json:"method"`
	Path                 string         `json:"path"`
	Status               int            `json:"status"`
	DurationMS           int64          `json:"duration_ms"`
	Outcome              string         `json:"outcome,omitempty"`
	ErrorCode            string         `json:"error_code,omitempty"`
	RemoteIP             string         `json:"remote_ip,omitempty"`
	Request              Part           `json:"request"`
	Response             Part           `json:"response"`
}

func NormalizeProfile(profile string) CaptureProfile {
	if CaptureProfile(profile) == ProfileBoundedContent {
		return ProfileBoundedContent
	}
	return ProfileMetadata
}
