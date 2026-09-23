package requestlog

import (
	"context"
	"io"
	"sync"
	"testing"
	"time"
)

type memoryStore struct {
	mu      sync.Mutex
	payload map[string][]byte
}

func (s *memoryStore) Put(_ context.Context, key string, r io.Reader) error {
	value, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.payload == nil {
		s.payload = map[string][]byte{}
	}
	s.payload[key] = value
	return nil
}

func (*memoryStore) Get(context.Context, string) (io.ReadCloser, error) { return nil, ErrUnavailable }
func (*memoryStore) Exists(context.Context, string) (bool, error)       { return false, ErrUnavailable }

type allowQuota struct{}

func (allowQuota) Allow(context.Context, string, *int, int64) bool { return true }

func TestManagerSpoolsThenUploadsAndCleansUp(t *testing.T) {
	store := &memoryStore{}
	contestID := 10
	m := NewManager(ManagerConfig{
		Store: store, SpoolDir: t.TempDir(), SpoolMaxBytes: 1 << 20,
		QueueSize: 1, WorkerCount: 1, RetryAttempts: 1, Quota: allowQuota{},
	})
	tx := Transaction{
		ContentSchemaVersion: 1, EventID: "event-1", InstanceID: "instance-1",
		ContestID: &contestID, OccurredAt: time.Now().UTC(), CapturedAt: time.Now().UTC(),
		CaptureProfile: ProfileBoundedContent, BackendPodMapping: "unknown",
	}
	if got := m.Enqueue(tx); got != SubmissionQueued {
		t.Fatalf("enqueue = %q", got)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := m.Close(ctx); err != nil {
		t.Fatalf("close: %v", err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.payload) != 1 {
		t.Fatalf("stored transactions = %d", len(store.payload))
	}
}

func TestManagerQuotaSkipsWithoutQueueing(t *testing.T) {
	contestID := 10
	m := NewManager(ManagerConfig{Store: &memoryStore{}, SpoolDir: t.TempDir(), QueueSize: 1, Quota: denyQuota{}})
	defer m.Close(context.Background())
	if got := m.Enqueue(Transaction{EventID: "event-1", InstanceID: "instance-1", ContestID: &contestID}); got != SubmissionSkippedByPolicy {
		t.Fatalf("enqueue = %q", got)
	}
}

type denyQuota struct{}

func (denyQuota) Allow(context.Context, string, *int, int64) bool { return false }
