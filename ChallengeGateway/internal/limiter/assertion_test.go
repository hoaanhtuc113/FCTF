package limiter

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"challenge-gateway/internal/token"
)

type fakeAssertionRedis struct {
	redis.Scripter
	revoked map[string]bool
	used    map[string]bool
	err     error
}

func (client *fakeAssertionRedis) Ping(context.Context) *redis.StatusCmd {
	return redis.NewStatusResult("PONG", nil)
}

func (client *fakeAssertionRedis) Exists(_ context.Context, keys ...string) *redis.IntCmd {
	if client.err != nil {
		return redis.NewIntResult(0, client.err)
	}
	var count int64
	for _, key := range keys {
		if client.revoked[key] {
			count++
		}
	}
	return redis.NewIntResult(count, nil)
}

func (client *fakeAssertionRedis) SetArgs(_ context.Context, key string, _ interface{}, _ redis.SetArgs) *redis.StatusCmd {
	if client.err != nil {
		return redis.NewStatusResult("", client.err)
	}
	if client.used[key] {
		return redis.NewStatusResult("", redis.Nil)
	}
	client.used[key] = true
	return redis.NewStatusResult("OK", nil)
}

func TestAssertionValidatorConsumesURLAssertionOnce(t *testing.T) {
	client := &fakeAssertionRedis{revoked: map[string]bool{}, used: map[string]bool{}}
	validator := newAssertionValidator(client, "fctf:gateway", true, true)
	payload := token.Payload{
		Exp:        time.Now().Add(time.Minute).Unix(),
		InstanceID: "instance-1",
		JTI:        "assertion-1",
	}

	if err := validator.Validate(context.Background(), payload, true); err != nil {
		t.Fatalf("first exchange failed: %v", err)
	}
	if err := validator.Validate(context.Background(), payload, true); !errors.Is(err, ErrAssertionReplayed) {
		t.Fatalf("second exchange error = %v, want ErrAssertionReplayed", err)
	}
}

func TestAssertionValidatorRejectsRevokedInstance(t *testing.T) {
	client := &fakeAssertionRedis{
		revoked: map[string]bool{"fctf:gateway:assertion:revoked:instance:instance-1": true},
		used:    map[string]bool{},
	}
	validator := newAssertionValidator(client, "fctf:gateway", true, true)
	payload := token.Payload{
		Exp:        time.Now().Add(time.Minute).Unix(),
		InstanceID: "instance-1",
		JTI:        "assertion-1",
	}

	if err := validator.Validate(context.Background(), payload, false); !errors.Is(err, ErrAssertionRevoked) {
		t.Fatalf("Validate() error = %v, want ErrAssertionRevoked", err)
	}
}

func TestAssertionValidatorFailsClosedWhenRedisUnavailable(t *testing.T) {
	client := &fakeAssertionRedis{
		revoked: map[string]bool{},
		used:    map[string]bool{},
		err:     errors.New("redis unavailable"),
	}
	validator := newAssertionValidator(client, "fctf:gateway", true, true)
	payload := token.Payload{
		Exp:        time.Now().Add(time.Minute).Unix(),
		InstanceID: "instance-1",
		JTI:        "assertion-1",
	}

	if err := validator.Validate(context.Background(), payload, false); !errors.Is(err, ErrAssertionStoreUnavailable) {
		t.Fatalf("Validate() error = %v, want ErrAssertionStoreUnavailable", err)
	}
}
