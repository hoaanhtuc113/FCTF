package requestlog

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var ErrUnavailable = errors.New("request log object unavailable")

type ObjectStore interface {
	Put(ctx context.Context, key string, r io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Exists(ctx context.Context, key string) (bool, error)
}

// FileObjectStore is a development/test adapter. Production should replace it
// with an encrypted object-store adapter mounted behind the same interface.
type FileObjectStore struct{ Root string }

func (s FileObjectStore) path(key string) (string, error) {
	if strings.TrimSpace(s.Root) == "" || filepath.IsAbs(key) || strings.Contains(key, "..") {
		return "", ErrUnavailable
	}
	return filepath.Join(s.Root, filepath.FromSlash(key)), nil
}

func (s FileObjectStore) Put(ctx context.Context, key string, r io.Reader) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".request-log-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err = io.Copy(tmp, r); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func (s FileObjectStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	path, err := s.path(key)
	if err != nil {
		return nil, err
	}
	return os.Open(path)
}

func (s FileObjectStore) Exists(_ context.Context, key string) (bool, error) {
	path, err := s.path(key)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

func ObjectKey(tx Transaction) string {
	if !safeNamespace(tx.InstanceNamespace) || !isUUID(tx.EventID) {
		return ""
	}
	return fmt.Sprintf("request-logs/%s/%s/%s/%s/%s/transaction.json.gz", tx.OccurredAt.UTC().Format("2006"), tx.OccurredAt.UTC().Format("01"), tx.OccurredAt.UTC().Format("02"), tx.InstanceNamespace, tx.EventID)
}

func safeNamespace(value string) bool {
	if len(value) == 0 || len(value) > 63 || value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}

func ValidNamespace(value string) bool { return safeNamespace(value) }

func isUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	for i, r := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			continue
		}
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f' || r >= 'A' && r <= 'F') {
			return false
		}
	}
	return true
}

func safeSegment(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if !(r == '-' || r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

func DecodeGZIP(r io.Reader) (Transaction, error) {
	gr, err := gzip.NewReader(r)
	if err != nil {
		return Transaction{}, err
	}
	defer gr.Close()
	var tx Transaction
	err = json.NewDecoder(gr).Decode(&tx)
	return tx, err
}

func Expired(tx Transaction, ttl time.Duration, now time.Time) bool {
	return ttl > 0 && !tx.CapturedAt.IsZero() && now.Sub(tx.CapturedAt) > ttl
}
