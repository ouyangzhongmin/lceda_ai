package knowledge

import (
	"context"
	"errors"
	"time"

	redisv9 "github.com/redis/go-redis/v9"
)

type RedisImportTaskQueue struct {
	client    *redisv9.Client
	queueName string
	timeout   time.Duration
}

func NewRedisImportTaskQueue(client *redisv9.Client, queueName string) *RedisImportTaskQueue {
	if queueName == "" {
		queueName = "lceda:knowledge:import_tasks"
	}
	return &RedisImportTaskQueue{
		client:    client,
		queueName: queueName,
		timeout:   time.Second,
	}
}

func (q *RedisImportTaskQueue) Enqueue(taskUID string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := q.client.LPush(ctx, q.queueName, taskUID).Err(); err != nil {
		return false
	}
	return true
}

func (q *RedisImportTaskQueue) Dequeue(stop <-chan struct{}) (ImportTaskMessage, bool) {
	for {
		select {
		case <-stop:
			return ImportTaskMessage{}, false
		default:
		}
		ctx, cancel := context.WithTimeout(context.Background(), q.timeout+time.Second)
		result, err := q.client.BRPop(ctx, q.timeout, q.queueName).Result()
		cancel()
		if err == nil && len(result) == 2 {
			return ImportTaskMessage{
				TaskUID: result[1],
				Source:  "queue",
			}, true
		}
		if errors.Is(err, redisv9.Nil) {
			continue
		}
		if err != nil {
			select {
			case <-stop:
				return ImportTaskMessage{}, false
			case <-time.After(200 * time.Millisecond):
				continue
			}
		}
	}
}

func (q *RedisImportTaskQueue) Ack(_ string) error {
	return nil
}

func (q *RedisImportTaskQueue) PendingCount() (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return q.client.LLen(ctx, q.queueName).Result()
}

func (q *RedisImportTaskQueue) Close() {
	// Redis queue is external and shared; no local close is required here.
}
