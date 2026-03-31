package knowledge

import (
	"context"
	"errors"
	"time"

	redisv9 "github.com/redis/go-redis/v9"
)

type RedisStreamImportTaskQueue struct {
	client         *redisv9.Client
	stream         string
	group          string
	consumer       string
	blockTimeout   time.Duration
	claimMinIdle   time.Duration
	claimEnabled   bool
	claimCount     int64
	claimInterval  time.Duration
	lastClaimAt    time.Time
}

type RedisStreamImportTaskQueueOptions struct {
	Stream       string
	Group        string
	Consumer     string
	BlockTimeout time.Duration
	ClaimMinIdle time.Duration
	ClaimEnabled bool
	ClaimCount   int64
	ClaimInterval time.Duration
}

func NewRedisStreamImportTaskQueue(
	client *redisv9.Client,
	options RedisStreamImportTaskQueueOptions,
) *RedisStreamImportTaskQueue {
	stream := options.Stream
	if stream == "" {
		stream = "lceda:knowledge:import_tasks:stream"
	}
	group := options.Group
	if group == "" {
		group = "lceda_import_task_workers"
	}
	consumer := options.Consumer
	if consumer == "" {
		consumer = "worker_default"
	}
	blockTimeout := options.BlockTimeout
	if blockTimeout <= 0 {
		blockTimeout = 2 * time.Second
	}
	claimMinIdle := options.ClaimMinIdle
	if claimMinIdle <= 0 {
		claimMinIdle = 30 * time.Second
	}
	claimCount := options.ClaimCount
	if claimCount <= 0 {
		claimCount = 1
	}
	claimInterval := options.ClaimInterval
	if claimInterval <= 0 {
		claimInterval = 2 * time.Second
	}
	queue := &RedisStreamImportTaskQueue{
		client:       client,
		stream:       stream,
		group:        group,
		consumer:     consumer,
		blockTimeout: blockTimeout,
		claimMinIdle: claimMinIdle,
		claimEnabled: options.ClaimEnabled,
		claimCount:   claimCount,
		claimInterval: claimInterval,
	}
	queue.ensureGroup()
	return queue
}

func (q *RedisStreamImportTaskQueue) Enqueue(taskUID string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := q.client.XAdd(ctx, &redisv9.XAddArgs{
		Stream: q.stream,
		Values: map[string]any{
			"task_uid": taskUID,
		},
	}).Result()
	return err == nil
}

func (q *RedisStreamImportTaskQueue) Dequeue(stop <-chan struct{}) (ImportTaskMessage, bool) {
	for {
		select {
		case <-stop:
			return ImportTaskMessage{}, false
		default:
		}

		if q.shouldClaimNow() {
			if claimed, ok := q.claimPending(); ok {
				return claimed, true
			}
		}

		ctx, cancel := context.WithTimeout(context.Background(), q.blockTimeout+time.Second)
		streams, err := q.client.XReadGroup(ctx, &redisv9.XReadGroupArgs{
			Group:    q.group,
			Consumer: q.consumer,
			Streams:  []string{q.stream, ">"},
			Count:    1,
			Block:    q.blockTimeout,
			NoAck:    false,
		}).Result()
		cancel()
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
		if len(streams) == 0 || len(streams[0].Messages) == 0 {
			continue
		}
		msg := streams[0].Messages[0]
		taskUID, ok := readTaskUID(msg.Values)
		if !ok {
			_ = q.Ack(msg.ID)
			continue
		}
		return ImportTaskMessage{
			TaskUID: taskUID,
			Receipt: msg.ID,
			Source:  "new",
		}, true
	}
}

func (q *RedisStreamImportTaskQueue) Ack(receipt string) error {
	if receipt == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := q.client.XAck(ctx, q.stream, q.group, receipt).Err(); err != nil {
		return err
	}
	_ = q.client.XDel(ctx, q.stream, receipt).Err()
	return nil
}

func (q *RedisStreamImportTaskQueue) Close() {
	// External resource; no local close is required.
}

func (q *RedisStreamImportTaskQueue) ensureGroup() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = q.client.XGroupCreateMkStream(ctx, q.stream, q.group, "0").Err()
}

func (q *RedisStreamImportTaskQueue) claimPending() (ImportTaskMessage, bool) {
	q.lastClaimAt = time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	messages, _, err := q.client.XAutoClaim(ctx, &redisv9.XAutoClaimArgs{
		Stream:   q.stream,
		Group:    q.group,
		Consumer: q.consumer,
		MinIdle:  q.claimMinIdle,
		Start:    "0-0",
		Count:    q.claimCount,
	}).Result()
	if err != nil || len(messages) == 0 {
		return ImportTaskMessage{}, false
	}
	msg := messages[0]
	taskUID, ok := readTaskUID(msg.Values)
	if !ok {
		_ = q.Ack(msg.ID)
		return ImportTaskMessage{}, false
	}
	return ImportTaskMessage{
		TaskUID: taskUID,
		Receipt: msg.ID,
		Source:  "claim",
	}, true
}

func (q *RedisStreamImportTaskQueue) shouldClaimNow() bool {
	if !q.claimEnabled {
		return false
	}
	if q.lastClaimAt.IsZero() {
		return true
	}
	return time.Since(q.lastClaimAt) >= q.claimInterval
}

func readTaskUID(values map[string]any) (string, bool) {
	if raw, ok := values["task_uid"]; ok {
		switch v := raw.(type) {
		case string:
			if v != "" {
				return v, true
			}
		}
	}
	return "", false
}

func (q *RedisStreamImportTaskQueue) PendingCount() (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result, err := q.client.XPending(ctx, q.stream, q.group).Result()
	if err != nil {
		return 0, err
	}
	return result.Count, nil
}
