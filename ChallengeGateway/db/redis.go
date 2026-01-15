package db

import (
    "context"
	"fmt"
    "github.com/redis/go-redis/v9"
)

var ctx = context.Background()
const TokenPrefix = "host:auth:"
func InitRedis(addr string, password string) (*redis.Client, error) {
    rdb := redis.NewClient(&redis.Options{
        Addr:     addr,
        Password: password, 
        DB:       0,
    })

    _, err := rdb.Ping(ctx).Result()
    if err != nil {
        return nil, err
    }
    return rdb, nil
}

func GetChallengeConnectionByToken(rdb *redis.Client, token string) (string, error) {
	fullKey := fmt.Sprintf("%s%s", TokenPrefix, token)

	challengeName, err := rdb.Get(ctx, fullKey).Result()
	if err != nil {
		return "", err
	}
	return challengeName, nil
}