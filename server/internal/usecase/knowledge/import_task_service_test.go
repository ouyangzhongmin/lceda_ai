package knowledge

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"lceda_ai/server/internal/repository/memory"
)

type stubTaskLocker struct {
	tryLock func(taskUID string, ttl time.Duration) (bool, error)
	unlock  func(taskUID string) error
}

type stubImportTaskQueue struct {
	mu       sync.Mutex
	ch       chan ImportTaskMessage
	ackCalls int
	failAcks int
}

func newStubImportTaskQueue(buffer int) *stubImportTaskQueue {
	if buffer <= 0 {
		buffer = 16
	}
	return &stubImportTaskQueue{
		ch: make(chan ImportTaskMessage, buffer),
	}
}

func (q *stubImportTaskQueue) Enqueue(taskUID string) bool {
	q.ch <- ImportTaskMessage{TaskUID: taskUID, Receipt: "rcpt_" + taskUID, Source: "queue"}
	return true
}

func (q *stubImportTaskQueue) Dequeue(stop <-chan struct{}) (ImportTaskMessage, bool) {
	select {
	case <-stop:
		return ImportTaskMessage{}, false
	case message := <-q.ch:
		return message, true
	}
}

func (q *stubImportTaskQueue) Ack(_ string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.ackCalls++
	if q.failAcks > 0 {
		q.failAcks--
		return errors.New("ack failed")
	}
	return nil
}

func (q *stubImportTaskQueue) Close() {
}

func (q *stubImportTaskQueue) PendingCount() (int64, error) {
	return int64(len(q.ch)), nil
}

func (q *stubImportTaskQueue) AckCalls() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.ackCalls
}

func (s *stubTaskLocker) TryLock(taskUID string, ttl time.Duration) (bool, error) {
	if s.tryLock == nil {
		return true, nil
	}
	return s.tryLock(taskUID, ttl)
}

func (s *stubTaskLocker) Unlock(taskUID string) error {
	if s.unlock == nil {
		return nil
	}
	return s.unlock(taskUID)
}

func mustCreateTask(t *testing.T, svc *ImportTaskService, req ImportTaskRequest) ImportTask {
	t.Helper()
	task, err := svc.CreateTask(req)
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	return task
}

func mustRunTask(t *testing.T, svc *ImportTaskService, taskUID string) (ImportTask, bool) {
	t.Helper()
	task, ok, err := svc.RunTask(taskUID)
	if err != nil {
		t.Fatalf("run task: %v", err)
	}
	return task, ok
}

func mustGetTask(t *testing.T, svc *ImportTaskService, taskUID string) (ImportTask, bool) {
	t.Helper()
	task, ok, err := svc.GetTask(taskUID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	return task, ok
}

func mustRetryTask(t *testing.T, svc *ImportTaskService, taskUID string) (ImportTask, bool) {
	t.Helper()
	task, ok, err := svc.RetryTask(taskUID)
	if err != nil {
		t.Fatalf("retry task: %v", err)
	}
	return task, ok
}

func TestImportTaskRunWithContent(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)

	task := mustCreateTask(t, taskService, ImportTaskRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-a",
		Lang:       "zh-CN",
		Title:      "Doc A",
		Content:    "first content",
	})
	result, ok := mustRunTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected run task success")
	}
	if result.Status != ImportTaskSucceeded {
		t.Fatalf("expected succeeded, got %s", result.Status)
	}
	if result.DocumentUID == "" {
		t.Fatal("expected document uid")
	}
	if result.ImportMode != ImportModeCreated {
		t.Fatalf("expected import mode created, got %s", result.ImportMode)
	}
}

func TestImportTaskRunWithFilePath(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)

	dir := t.TempDir()
	filePath := filepath.Join(dir, "kb.txt")
	if err := os.WriteFile(filePath, []byte("from file content"), 0o644); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	task := mustCreateTask(t, taskService, ImportTaskRequest{
		KBType:     "component",
		SourceType: "manual",
		SourceRef:  "doc-b",
		Lang:       "zh-CN",
		Title:      "Doc B",
		FilePath:   filePath,
	})
	result, ok := mustRunTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected run task success")
	}
	if result.Status != ImportTaskSucceeded {
		t.Fatalf("expected succeeded, got %s", result.Status)
	}
}

func TestImportTaskRunInvalidInput(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.maxAttempts = 1

	task := mustCreateTask(t, taskService, ImportTaskRequest{
		Title: "Invalid",
	})
	result, ok := mustRunTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected run task success with failed status")
	}
	if result.Status != ImportTaskFailed {
		t.Fatalf("expected failed, got %s", result.Status)
	}
	if result.ErrorMessage == "" {
		t.Fatal("expected error message")
	}
}

func TestImportTaskWorkerRetryToFailed(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.retryDelay = 10 * time.Millisecond
	taskService.StartWorker()
	defer taskService.StopWorker()

	task := mustCreateTask(t, taskService, ImportTaskRequest{
		Title: "Invalid Retry",
	})

	deadline := time.Now().Add(500 * time.Millisecond)
	for {
		current, ok := mustGetTask(t, taskService, task.TaskUID)
		if !ok {
			t.Fatal("task should exist")
		}
		if current.Status == ImportTaskFailed {
			if current.Attempts != current.MaxAttempts {
				t.Fatalf("expected attempts=%d got %d", current.MaxAttempts, current.Attempts)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("task did not reach failed state, current status=%s attempts=%d", current.Status, current.Attempts)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestImportTaskStatsAndDeadLetters(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.maxAttempts = 1

	task := mustCreateTask(t, taskService, ImportTaskRequest{
		Title: "DeadLetter",
	})
	result, ok := mustRunTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected run task success with failed status")
	}
	if result.Status != ImportTaskFailed {
		t.Fatalf("expected failed, got %s", result.Status)
	}

	stats := taskService.Stats()
	if stats.TotalCreated < 1 {
		t.Fatalf("expected total_created >= 1, got %d", stats.TotalCreated)
	}
	if stats.FailedCount < 1 {
		t.Fatalf("expected failed_count >= 1, got %d", stats.FailedCount)
	}
	if stats.DeadLetterCount < 1 {
		t.Fatalf("expected dead_letter_count >= 1, got %d", stats.DeadLetterCount)
	}

	deadLetters := taskService.ListDeadLetters(10)
	if len(deadLetters) == 0 {
		t.Fatal("expected at least one dead letter record")
	}
	if deadLetters[len(deadLetters)-1].TaskUID != task.TaskUID {
		t.Fatalf("unexpected task uid in dead letter: %s", deadLetters[len(deadLetters)-1].TaskUID)
	}
}

func TestRetryTaskResetsFailedState(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.maxAttempts = 1

	task := mustCreateTask(t, taskService, ImportTaskRequest{
		Title: "RetryDeadLetter",
	})
	failed, ok := mustRunTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected failed task")
	}
	if failed.Status != ImportTaskFailed {
		t.Fatalf("expected failed status, got %s", failed.Status)
	}
	if failed.Attempts != 1 {
		t.Fatalf("expected attempts=1, got %d", failed.Attempts)
	}

	retried, ok := mustRetryTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected retry task success")
	}
	if retried.Status != ImportTaskQueued {
		t.Fatalf("expected queued status, got %s", retried.Status)
	}
	if retried.Attempts != 0 {
		t.Fatalf("expected attempts reset to 0, got %d", retried.Attempts)
	}
	if retried.ErrorMessage != "" {
		t.Fatalf("expected empty error message, got %s", retried.ErrorMessage)
	}

	stats := taskService.Stats()
	if stats.ManualRetryCount < 1 {
		t.Fatalf("expected manual_retry_count >= 1, got %d", stats.ManualRetryCount)
	}
}

func TestRetryTaskStrictRejectsNonDeadLetterTask(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	task := mustCreateTask(t, taskService, ImportTaskRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-retry-reject",
		Lang:       "zh-CN",
		Title:      "RetryReject",
		Content:    "ok",
	})

	_, ok, err := taskService.RetryTaskStrict(task.TaskUID)
	if !ok {
		t.Fatal("expected task exists")
	}
	if err == nil {
		t.Fatal("expected retry reject error for non-dead-letter task")
	}
	stats := taskService.Stats()
	if stats.ManualRetryRejectedCount < 1 {
		t.Fatalf("expected manual_retry_rejected_count >= 1, got %d", stats.ManualRetryRejectedCount)
	}
}

func TestCreateTaskDedupByIdempotencyKey(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)

	req := ImportTaskRequest{
		KBType:         "principle",
		SourceType:     "manual",
		SourceRef:      "doc-idem-1",
		Lang:           "zh-CN",
		Title:          "Same Task",
		Content:        "same content",
		IdempotencyKey: "idem-key-001",
	}
	first := mustCreateTask(t, taskService, req)
	second := mustCreateTask(t, taskService, req)
	if first.TaskUID != second.TaskUID {
		t.Fatalf("expected same task uid for duplicated idempotency key, got %s %s", first.TaskUID, second.TaskUID)
	}
	stats := taskService.Stats()
	if stats.DeduplicatedCreateCount < 1 {
		t.Fatalf("expected deduplicated_create_count >= 1, got %d", stats.DeduplicatedCreateCount)
	}
}

func TestProcessOneAttemptConcurrentGuard(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	task := mustCreateTask(t, taskService, ImportTaskRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-concurrent-1",
		Lang:       "zh-CN",
		Title:      "Concurrent",
		Content:    "concurrent content",
	})

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = mustRunTask(t, taskService, task.TaskUID)
	}()
	go func() {
		defer wg.Done()
		_, _ = mustRunTask(t, taskService, task.TaskUID)
	}()
	wg.Wait()

	current, ok := mustGetTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected task to exist")
	}
	if current.Attempts != 1 {
		t.Fatalf("expected attempts=1 with concurrent guard, got %d", current.Attempts)
	}
}

func TestRunTaskLockConflict(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.SetTaskLocker(&stubTaskLocker{
		tryLock: func(_ string, _ time.Duration) (bool, error) {
			return false, nil
		},
	})
	task := mustCreateTask(t, taskService, ImportTaskRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-lock-1",
		Lang:       "zh-CN",
		Title:      "LockConflict",
		Content:    "x",
	})
	result, ok := mustRunTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected task exist on lock conflict")
	}
	if result.Attempts != 0 {
		t.Fatalf("expected attempts=0 on lock conflict, got %d", result.Attempts)
	}
	stats := taskService.Stats()
	if stats.LockConflictCount < 1 {
		t.Fatalf("expected lock_conflict_count >= 1, got %d", stats.LockConflictCount)
	}
}

func TestRunTaskLockError(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.SetTaskLocker(&stubTaskLocker{
		tryLock: func(_ string, _ time.Duration) (bool, error) {
			return false, errors.New("locker unavailable")
		},
	})
	task := mustCreateTask(t, taskService, ImportTaskRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-lock-2",
		Lang:       "zh-CN",
		Title:      "LockError",
		Content:    "y",
	})
	_, ok, err := taskService.RunTask(task.TaskUID)
	if err == nil {
		t.Fatal("expected lock error")
	}
	if ok {
		t.Fatal("expected run task failure on lock error")
	}
	stats := taskService.Stats()
	if stats.LockErrorCount < 1 {
		t.Fatalf("expected lock_error_count >= 1, got %d", stats.LockErrorCount)
	}
}

func TestAckWithRetrySuccess(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	queue := newStubImportTaskQueue(4)
	queue.failAcks = 1
	taskService.taskQueue = queue
	taskService.SetAckRetryPolicy(2, time.Millisecond)

	err := taskService.ackWithRetry("rcpt_1")
	if err != nil {
		t.Fatalf("expected ack retry success, got error: %v", err)
	}
	if queue.AckCalls() != 2 {
		t.Fatalf("expected 2 ack calls, got %d", queue.AckCalls())
	}
	stats := taskService.Stats()
	if stats.AckRetryCount != 1 {
		t.Fatalf("expected ack_retry_count=1, got %d", stats.AckRetryCount)
	}
}

func TestAckWithRetryExhausted(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	queue := newStubImportTaskQueue(4)
	queue.failAcks = 5
	taskService.taskQueue = queue
	taskService.SetAckRetryPolicy(2, time.Millisecond)

	err := taskService.ackWithRetry("rcpt_2")
	if err == nil {
		t.Fatal("expected ack retry exhausted error")
	}
	if queue.AckCalls() != 3 {
		t.Fatalf("expected 3 ack calls, got %d", queue.AckCalls())
	}
	stats := taskService.Stats()
	if stats.AckRetryCount != 2 {
		t.Fatalf("expected ack_retry_count=2, got %d", stats.AckRetryCount)
	}
}

func TestSetTaskRetryPolicyAffectsCreatedTask(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.SetTaskRetryPolicy(5, 3*time.Second)

	task := mustCreateTask(t, taskService, ImportTaskRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-policy-1",
		Lang:       "zh-CN",
		Title:      "RetryPolicy",
		Content:    "policy content",
	})
	if task.MaxAttempts != 5 {
		t.Fatalf("expected max_attempts=5, got %d", task.MaxAttempts)
	}
}

func TestRetryStatsFixedBackoff(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.SetTaskRetryPolicy(3, 15*time.Millisecond)
	taskService.SetTaskRetryBackoffPolicy("fixed", 100*time.Millisecond)

	task := mustCreateTask(t, taskService, ImportTaskRequest{Title: "retry-fixed"})
	_, ok := mustRunTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected task run result")
	}
	stats := taskService.Stats()
	if stats.RetryScheduledCount < 1 {
		t.Fatalf("expected retry_scheduled_count >= 1, got %d", stats.RetryScheduledCount)
	}
	if stats.RetryDelayLastMS != 15 {
		t.Fatalf("expected retry_delay_last_ms=15, got %d", stats.RetryDelayLastMS)
	}
	if stats.RetryDelayTotalMS < 15 {
		t.Fatalf("expected retry_delay_total_ms >= 15, got %d", stats.RetryDelayTotalMS)
	}
	if stats.RetryBackoffFixedCount < 1 {
		t.Fatalf("expected retry_backoff_fixed_count >= 1, got %d", stats.RetryBackoffFixedCount)
	}
}

func TestRetryStatsExponentialBackoff(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.SetTaskRetryPolicy(3, 10*time.Millisecond)
	taskService.SetTaskRetryBackoffPolicy("exponential", 100*time.Millisecond)

	task := mustCreateTask(t, taskService, ImportTaskRequest{Title: "retry-exp"})
	_, ok := mustRunTask(t, taskService, task.TaskUID)
	if !ok {
		t.Fatal("expected task run result")
	}
	stats := taskService.Stats()
	if stats.RetryBackoffExponentialCount < 1 {
		t.Fatalf("expected retry_backoff_exponential_count >= 1, got %d", stats.RetryBackoffExponentialCount)
	}
}

func TestComputeRetryDelayFixed(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.SetTaskRetryPolicy(3, 20*time.Millisecond)
	taskService.SetTaskRetryBackoffPolicy("fixed", 100*time.Millisecond)

	d1 := taskService.computeRetryDelay(1)
	d3 := taskService.computeRetryDelay(3)
	if d1 != 20*time.Millisecond || d3 != 20*time.Millisecond {
		t.Fatalf("expected fixed delay 20ms, got d1=%v d3=%v", d1, d3)
	}
}

func TestComputeRetryDelayExponentialWithCap(t *testing.T) {
	service := NewService(memory.NewKnowledgeRepository())
	taskService := NewImportTaskService(service)
	taskService.SetTaskRetryPolicy(5, 10*time.Millisecond)
	taskService.SetTaskRetryBackoffPolicy("exponential", 25*time.Millisecond)

	d1 := taskService.computeRetryDelay(1)
	d2 := taskService.computeRetryDelay(2)
	d3 := taskService.computeRetryDelay(3)
	if d1 != 10*time.Millisecond {
		t.Fatalf("expected d1=10ms, got %v", d1)
	}
	if d2 != 20*time.Millisecond {
		t.Fatalf("expected d2=20ms, got %v", d2)
	}
	if d3 != 25*time.Millisecond {
		t.Fatalf("expected d3 capped at 25ms, got %v", d3)
	}
}
