package limiter

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"challenge-gateway/internal/token"
)

var (
	ErrAssertionRevoked          = errors.New("challenge assertion revoked")
	ErrAssertionReplayed         = errors.New("challenge assertion already exchanged")
	ErrAssertionStoreUnavailable = errors.New("challenge assertion store unavailable")
	ErrAssertionIDRequired       = errors.New("challenge assertion id required")
)

// AssertionValidator guards the stateful parts of an otherwise stateless
// signed assertion. It never logs or stores the bearer token itself: Redis keys
// contain only the signed jti or immutable instance_id.
type AssertionValidator interface {
	Validate(ctx context.Context, payload token.Payload, consumeOneTime bool) error
}

type redisAssertionValidator struct {
	client     RedisClient
	prefix     string
	failClosed bool
	requireJTI bool
}

func newAssertionValidator(client RedisClient, prefix string, failClosed, requireJTI bool) AssertionValidator {
	return &redisAssertionValidator{
		client:     client,
		prefix:     prefix + ":assertion",
		failClosed: failClosed,
		requireJTI: requireJTI,
	}
}

func (validator *redisAssertionValidator) Validate(ctx context.Context, payload token.Payload, consumeOneTime bool) error {
	if validator.requireJTI && payload.JTI == "" {
		return ErrAssertionIDRequired
	}

	if payload.InstanceID != "" {
		revoked, err := validator.client.Exists(ctx, validator.revokedKey(payload.InstanceID)).Result()
		if err != nil {
			if validator.failClosed {
				return fmt.Errorf("%w: %v", ErrAssertionStoreUnavailable, err)
			}
		} else if revoked > 0 {
			return ErrAssertionRevoked
		}
	}

	if !consumeOneTime || payload.JTI == "" {
		return nil
	}

	ttl := time.Until(time.Unix(payload.Exp, 0))
	if ttl <= 0 {
		return ErrAssertionReplayed
	}
	err := validator.client.SetArgs(ctx, validator.usedKey(payload.JTI), "1", redis.SetArgs{
		Mode: "NX",
		TTL:  ttl,
	}).Err()
	if err == nil {
		return nil
	}
	if errors.Is(err, redis.Nil) {
		return ErrAssertionReplayed
	}
	if validator.failClosed {
		return fmt.Errorf("%w: %v", ErrAssertionStoreUnavailable, err)
	}
	return nil
}

func (validator *redisAssertionValidator) revokedKey(instanceID string) string {
	return validator.prefix + ":revoked:instance:" + instanceID
}

func (validator *redisAssertionValidator) usedKey(assertionID string) string {
	return validator.prefix + ":used:jti:" + assertionID
}

// AssertionErrorCode is safe for telemetry and API responses; it does not
// expose the Redis error, assertion ID, or signed token.
func AssertionErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrAssertionRevoked):
		return "assertion_revoked"
	case errors.Is(err, ErrAssertionReplayed):
		return "assertion_replayed"
	case errors.Is(err, ErrAssertionStoreUnavailable):
		return "assertion_store_unavailable"
	case errors.Is(err, ErrAssertionIDRequired):
		return "assertion_id_required"
	default:
		return "invalid_assertion"
	}
}
