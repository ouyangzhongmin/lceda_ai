package knowledge

import (
	"errors"
	"math"
	"os"
	"strings"
	"time"
)

type importTaskRuntimeConfig struct {
	locker           ImportTaskLocker
	lockTTL          time.Duration
	retryDelay       time.Duration
	retryBackoffMode string
	retryMaxDelay    time.Duration
	ackRetryCount    int
	ackRetryInterval time.Duration
}

func (s *ImportTaskService) runtimeConfig() importTaskRuntimeConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	locker := s.taskLocker
	if locker == nil {
		locker = NewNoopImportTaskLocker()
	}

	return importTaskRuntimeConfig{
		locker:           locker,
		lockTTL:          s.taskLockTTL,
		retryDelay:       s.retryDelay,
		retryBackoffMode: s.retryBackoffMode,
		retryMaxDelay:    s.retryMaxDelay,
		ackRetryCount:    s.ackRetryCount,
		ackRetryInterval: s.ackRetryInterval,
	}
}

func (s *ImportTaskService) withTaskProcessing(taskUID string, fn func() (ImportTask, bool, error)) (ImportTask, bool, error) {
	s.mu.Lock()
	if _, isRunning := s.processingTasks[taskUID]; isRunning {
		task, ok, err := s.taskRepo.FindTask(taskUID)
		s.mu.Unlock()
		return task, ok, err
	}
	s.processingTasks[taskUID] = struct{}{}
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.processingTasks, taskUID)
		s.mu.Unlock()
	}()

	return fn()
}

func (s *ImportTaskService) startTaskAttempt(task ImportTask) (ImportTask, error) {
	now := time.Now()
	task.Status = ImportTaskRunning
	task.StartedAt = &now
	task.Attempts++
	task.NextRunAt = nil
	task.ErrorMessage = ""

	s.mu.Lock()
	s.stats.RunningCount++
	s.mu.Unlock()

	if err := s.taskRepo.SaveTask(task); err != nil {
		s.mu.Lock()
		if s.stats.RunningCount > 0 {
			s.stats.RunningCount--
		}
		s.mu.Unlock()
		return ImportTask{}, err
	}
	return task, nil
}

func (s *ImportTaskService) finishRunningTask() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finishRunningTaskLocked()
}

func (s *ImportTaskService) finishRunningTaskLocked() {
	if s.stats.RunningCount > 0 {
		s.stats.RunningCount--
	}
}

func (s *ImportTaskService) scheduleRetry(task ImportTask, taskUID string, finishedAt time.Time, err error) (ImportTask, error) {
	delay := s.computeRetryDelayLocked(task.Attempts)
	nextRunAt := time.Now().Add(delay)
	task.Status = ImportTaskQueued
	task.ErrorMessage = err.Error()
	task.NextRunAt = &nextRunAt
	task.LastErrorAt = &finishedAt

	s.stats.RetryScheduledCount++
	s.stats.RetryDelayLastMS = delay.Milliseconds()
	s.stats.RetryDelayTotalMS += delay.Milliseconds()
	if s.retryBackoffMode == "exponential" {
		s.stats.RetryBackoffExponentialCount++
	} else {
		s.stats.RetryBackoffFixedCount++
	}

	if err := s.taskRepo.SaveTask(task); err != nil {
		return ImportTask{}, err
	}
	go s.enqueueAfter(taskUID, delay)
	return task, nil
}

func (s *ImportTaskService) moveToDeadLetter(task ImportTask, finishedAt time.Time, err error) (ImportTask, error) {
	task.Status = ImportTaskFailed
	task.ErrorMessage = err.Error()
	task.LastErrorAt = &finishedAt
	s.stats.FailedCount++

	if err := s.taskRepo.SaveTask(task); err != nil {
		return ImportTask{}, err
	}

	record := DeadLetterRecord{
		TaskUID:      task.TaskUID,
		ErrorMessage: task.ErrorMessage,
		Attempts:     task.Attempts,
		MaxAttempts:  task.MaxAttempts,
		FailedAt:     finishedAt,
	}
	if err := s.taskRepo.AppendDeadLetter(record); err != nil {
		return ImportTask{}, err
	}
	s.refreshDeadLetterCountLocked()
	return task, nil
}

func (s *ImportTaskService) completeSuccessfulImport(task ImportTask, result ImportResult) (ImportTask, error) {
	task.Status = ImportTaskSucceeded
	task.DocumentUID = result.Document.DocumentUID
	task.ImportMode = result.Mode
	task.ChunkCount = len(result.Chunks)
	s.stats.SucceededCount++
	if err := s.taskRepo.SaveTask(task); err != nil {
		return ImportTask{}, err
	}
	return task, nil
}

func (s *ImportTaskService) ackRetryConfig() (int, time.Duration) {
	cfg := s.runtimeConfig()
	return cfg.ackRetryCount, cfg.ackRetryInterval
}

func computeRetryDelayByPolicy(base time.Duration, mode string, maxDelay time.Duration, attempt int) time.Duration {
	if mode != "exponential" {
		return base
	}
	if attempt <= 1 {
		if base > maxDelay {
			return maxDelay
		}
		return base
	}
	factor := math.Pow(2, float64(attempt-1))
	delay := time.Duration(float64(base) * factor)
	if delay > maxDelay {
		return maxDelay
	}
	return delay
}

func resolveImportContent(req ImportTaskRequest) (string, error) {
	content := strings.TrimSpace(req.Content)
	if content != "" {
		return content, nil
	}
	filePath := strings.TrimSpace(req.FilePath)
	if filePath == "" {
		return "", errors.New("content or file_path is required")
	}
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(raw)), nil
}
