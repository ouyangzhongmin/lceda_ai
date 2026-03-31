package knowledge

import (
	"context"
	"time"

	redisv9 "github.com/redis/go-redis/v9"
)

type RedisImportTaskLocker struct {
	client *redisv9.Client
	prefix string
}

func NewRedisImportTaskLocker(client *redisv9.Client, prefix string) *RedisImportTaskLocker {
	if prefix == "" {
		prefix = "lceda:knowledge:import_task_lock:"
	}
	return &RedisImportTaskLocker{
		client: client,
		prefix: prefix,
	}
}

func (l *RedisImportTaskLocker) TryLock(taskUID string, ttl time.Duration) (bool, error) {
	key := l.prefix + taskUID
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ok, err := l.client.SetNX(ctx, key, "1", ttl).Result()
	if err != nil {
		return false, err
	}
	return ok, nil
}

func (l *RedisImportTaskLocker) Unlock(taskUID string) error {
	key := l.prefix + taskUID
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return l.client.Del(ctx, key).Err()
}
