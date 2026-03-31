package redis

import (
	"context"
	"time"

	redisv9 "github.com/redis/go-redis/v9"
	"lceda_ai/server/internal/app"
)

func OpenClient(cfg app.RedisConfig) (*redisv9.Client, error) {
	client := redisv9.NewClient(&redisv9.Options{
		Addr:         cfg.Addr,
		Password:     cfg.Password,
		DB:           cfg.DB,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}
	return client, nil
}
