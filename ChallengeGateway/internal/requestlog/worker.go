package requestlog

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"challenge-gateway/internal/telemetry"
)

// Quota controls persistence only. A quota failure can never reject or delay
// participant traffic.
type Quota interface {
	Allow(ctx context.Context, instanceID string, contestID *int, bytes int64) bool
}

type ManagerConfig struct {
	ObjectDir     string // development-only FileObjectStore fallback
	QueueSize     int
	RetryAttempts int
	WorkerCount   int
	SpoolDir      string
	SpoolMaxBytes int64
	Store         ObjectStore
	Quota         Quota
}

type Manager struct {
	store         ObjectStore
	quota         Quota
	queue         chan Transaction
	done          chan struct{}
	once          sync.Once
	workers       sync.WaitGroup
	retryAttempts int
	spoolDir      string
	spoolMaxBytes int64
	spoolMu       sync.Mutex
	spoolBytes    int64
}

func (m *Manager) Enabled() bool { return m != nil && m.store != nil && m.spoolDir != "" }

func NewManager(cfg ManagerConfig) *Manager {
	store := cfg.Store
	if store == nil && cfg.ObjectDir != "" {
		store = FileObjectStore{Root: cfg.ObjectDir}
	}
	if cfg.QueueSize <= 0 {
		cfg.QueueSize = 128
	}
	if cfg.RetryAttempts <= 0 {
		cfg.RetryAttempts = 3
	}
	if cfg.WorkerCount <= 0 {
		cfg.WorkerCount = 1
	}
	if cfg.SpoolMaxBytes <= 0 {
		cfg.SpoolMaxBytes = 256 << 20
	}
	m := &Manager{
		store: store, quota: cfg.Quota, queue: make(chan Transaction, cfg.QueueSize),
		done: make(chan struct{}), retryAttempts: cfg.RetryAttempts, spoolDir: cfg.SpoolDir,
		spoolMaxBytes: cfg.SpoolMaxBytes,
	}
	if store == nil {
		close(m.done)
		return m
	}
	for range cfg.WorkerCount {
		m.workers.Add(1)
		go m.run()
	}
	go func() {
		m.workers.Wait()
		close(m.done)
	}()
	return m
}

// Enqueue never blocks the proxy path. Content is bounded per request and the
// channel is the second, global bound.
func (m *Manager) Enqueue(tx Transaction) Submission {
	if m == nil || m.store == nil {
		return SubmissionDropped
	}
	if m.quota != nil {
		quotaCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		allowed := m.quota.Allow(quotaCtx, tx.InstanceID, tx.ContestID, capturedBytes(tx))
		cancel()
		if !allowed {
			return SubmissionSkippedByPolicy
		}
	}
	tx.Submission = SubmissionQueued
	select {
	case m.queue <- tx:
		telemetry.SetCaptureQueueDepth(len(m.queue))
		return SubmissionQueued
	default:
		return SubmissionDropped
	}
}

func capturedBytes(tx Transaction) int64 {
	// Includes a bounded allowance for headers, parameters and JSON framing.
	return int64(tx.Request.CapturedSize+tx.Response.CapturedSize) + 128<<10
}

func (m *Manager) run() {
	defer m.workers.Done()
	for tx := range m.queue {
		telemetry.SetCaptureQueueDepth(len(m.queue))
		if key := ObjectKey(tx); key != "" {
			m.upload(tx, key)
		}
	}
}

func (m *Manager) upload(tx Transaction, key string) {
	started := time.Now()
	payload, err := encodeGZIPBytes(tx)
	if err != nil {
		telemetry.ObserveCaptureUploadError()
		return
	}
	if !m.reserveSpool(int64(len(payload))) {
		telemetry.ObserveCaptureDropped()
		return
	}
	defer m.releaseSpool(int64(len(payload)))

	path, err := m.writeSpool(payload)
	if err != nil {
		telemetry.ObserveCaptureUploadError()
		return
	}
	defer os.Remove(path)

	for attempt := 0; attempt < m.retryAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		err = m.putFile(ctx, key, path)
		cancel()
		if err == nil {
			telemetry.ObserveCaptureUploadSuccess()
			telemetry.ObserveCaptureUploadLatency(time.Since(started))
			return
		}
		telemetry.ObserveCaptureUploadError()
		if attempt+1 < m.retryAttempts {
			telemetry.ObserveCaptureUploadRetry()
			time.Sleep(time.Duration(attempt+1) * 100 * time.Millisecond)
		}
	}
}

func (m *Manager) writeSpool(payload []byte) (string, error) {
	if m.spoolDir == "" {
		return "", errors.New("request-log spool directory is not configured")
	}
	if err := os.MkdirAll(m.spoolDir, 0o700); err != nil {
		return "", err
	}
	f, err := os.CreateTemp(m.spoolDir, ".request-log-*.gz")
	if err != nil {
		return "", err
	}
	path := f.Name()
	if err := f.Chmod(0o600); err == nil {
		_, err = f.Write(payload)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}

func (m *Manager) putFile(ctx context.Context, key, path string) error {
	f, err := os.Open(filepath.Clean(path))
	if err != nil {
		return err
	}
	defer f.Close()
	return m.store.Put(ctx, key, f)
}

func (m *Manager) reserveSpool(bytes int64) bool {
	m.spoolMu.Lock()
	defer m.spoolMu.Unlock()
	if bytes < 0 || m.spoolBytes > m.spoolMaxBytes-bytes {
		return false
	}
	m.spoolBytes += bytes
	telemetry.SetCaptureSpoolBytes(m.spoolBytes)
	return true
}

func (m *Manager) releaseSpool(bytes int64) {
	m.spoolMu.Lock()
	m.spoolBytes -= bytes
	if m.spoolBytes < 0 {
		m.spoolBytes = 0
	}
	telemetry.SetCaptureSpoolBytes(m.spoolBytes)
	m.spoolMu.Unlock()
}

// Close drains the queue until ctx expires. main invokes this after HTTP
// shutdown; RegisterOnShutdown callbacks are asynchronous and cannot provide a
// finite flush guarantee.
func (m *Manager) Close(ctx context.Context) error {
	if m == nil || m.store == nil {
		return nil
	}
	m.once.Do(func() { close(m.queue) })
	select {
	case <-m.done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("request-log flush: %w", ctx.Err())
	}
}

func encodeGZIPBytes(tx Transaction) ([]byte, error) {
	var out bytes.Buffer
	gw := gzip.NewWriter(&out)
	if err := json.NewEncoder(gw).Encode(tx); err != nil {
		_ = gw.Close()
		return nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// EncodeGZIP remains available to small unit tests and development tools. The
// worker uses an on-disk spool so a failed upload cannot strand a pipe goroutine.
func EncodeGZIP(tx Transaction) (io.Reader, error) {
	payload, err := encodeGZIPBytes(tx)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(payload), nil
}
