package knowledge

import (
	"errors"
	"fmt"
	"hash/fnv"
	"strings"
	"sync"
	"time"

	"lceda_ai/server/internal/pkg/idgen"
)

type ImportTaskStatus string

const (
	ImportTaskQueued    ImportTaskStatus = "queued"
	ImportTaskRunning   ImportTaskStatus = "running"
	ImportTaskSucceeded ImportTaskStatus = "succeeded"
	ImportTaskFailed    ImportTaskStatus = "failed"
)

type ImportTaskRequest struct {
	KBType         string `json:"kb_type"`
	Title          string `json:"title"`
	SourceType     string `json:"source_type"`
	SourceRef      string `json:"source_ref"`
	Lang           string `json:"lang"`
	Content        string `json:"content"`
	FilePath       string `json:"file_path"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

type ImportTask struct {
	TaskUID      string            `json:"task_uid"`
	Status       ImportTaskStatus  `json:"status"`
	Request      ImportTaskRequest `json:"request"`
	DedupKey     string            `json:"dedup_key,omitempty"`
	Attempts     int               `json:"attempts"`
	MaxAttempts  int               `json:"max_attempts"`
	NextRunAt    *time.Time        `json:"next_run_at,omitempty"`
	LastErrorAt  *time.Time        `json:"last_error_at,omitempty"`
	DocumentUID  string            `json:"document_uid,omitempty"`
	ImportMode   ImportMode        `json:"import_mode,omitempty"`
	ChunkCount   int               `json:"chunk_count,omitempty"`
	ErrorMessage string            `json:"error_message,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
	StartedAt    *time.Time        `json:"started_at,omitempty"`
	FinishedAt   *time.Time        `json:"finished_at,omitempty"`
}

type DeadLetterRecord struct {
	TaskUID      string    `json:"task_uid"`
	ErrorMessage string    `json:"error_message"`
	Attempts     int       `json:"attempts"`
	MaxAttempts  int       `json:"max_attempts"`
	FailedAt     time.Time `json:"failed_at"`
}

type ImportTaskStats struct {
	TotalCreated                 int   `json:"total_created"`
	QueuePushAccepted            int   `json:"queue_push_accepted"`
	QueuePushDropped             int   `json:"queue_push_dropped"`
	Dequeued                     int   `json:"dequeued"`
	RunningCount                 int   `json:"running_count"`
	SucceededCount               int   `json:"succeeded_count"`
	FailedCount                  int   `json:"failed_count"`
	RetryScheduledCount          int   `json:"retry_scheduled_count"`
	RetryDelayLastMS             int64 `json:"retry_delay_last_ms"`
	RetryDelayTotalMS            int64 `json:"retry_delay_total_ms"`
	RetryBackoffFixedCount       int   `json:"retry_backoff_fixed_count"`
	RetryBackoffExponentialCount int   `json:"retry_backoff_exponential_count"`
	ManualRunCount               int   `json:"manual_run_count"`
	ManualEnqueueCount           int   `json:"manual_enqueue_count"`
	ManualRetryCount             int   `json:"manual_retry_count"`
	ManualRetryRejectedCount     int   `json:"manual_retry_rejected_count"`
	DeadLetterCount              int   `json:"dead_letter_count"`
	DeduplicatedCreateCount      int   `json:"deduplicated_create_count"`
	LockConflictCount            int   `json:"lock_conflict_count"`
	LockErrorCount               int   `json:"lock_error_count"`
	AckSuccessCount              int   `json:"ack_success_count"`
	AckErrorCount                int   `json:"ack_error_count"`
	AckRetryCount                int   `json:"ack_retry_count"`
	AckRetryExhaustedCount       int   `json:"ack_retry_exhausted_count"`
	ClaimedMessageCount          int   `json:"claimed_message_count"`
	StreamMessageCount           int   `json:"stream_message_count"`
	QueuePendingCount            int64 `json:"queue_pending_count"`
}

type ImportTaskService struct {
	mu               sync.RWMutex
	processingTasks  map[string]struct{}
	stats            ImportTaskStats
	knowledgeService *Service
	taskRepo         ImportTaskRepository
	taskQueue        ImportTaskQueue
	taskLocker       ImportTaskLocker
	stopCh           chan struct{}
	stoppedCh        chan struct{}
	workerStarted    bool
	maxAttempts      int
	retryDelay       time.Duration
	retryBackoffMode string
	retryMaxDelay    time.Duration
	taskLockTTL      time.Duration
	ackRetryCount    int
	ackRetryInterval time.Duration
}

func NewImportTaskService(knowledgeService *Service) *ImportTaskService {
	return &ImportTaskService{
		processingTasks:  make(map[string]struct{}),
		knowledgeService: knowledgeService,
		taskRepo:         NewInMemoryImportTaskRepository(),
		taskQueue:        NewInMemoryImportTaskQueue(256),
		taskLocker:       NewNoopImportTaskLocker(),
		stopCh:           make(chan struct{}),
		stoppedCh:        make(chan struct{}),
		maxAttempts:      3,
		retryDelay:       2 * time.Second,
		retryBackoffMode: "fixed",
		retryMaxDelay:    30 * time.Second,
		taskLockTTL:      60 * time.Second,
		ackRetryCount:    2,
		ackRetryInterval: 200 * time.Millisecond,
	}
}

func NewImportTaskServiceWithQueue(knowledgeService *Service, queue ImportTaskQueue, repo ...ImportTaskRepository) *ImportTaskService {
	if queue == nil {
		queue = NewInMemoryImportTaskQueue(256)
	}
	var taskRepo ImportTaskRepository = NewInMemoryImportTaskRepository()
	if len(repo) > 0 && repo[0] != nil {
		taskRepo = repo[0]
	}
	return &ImportTaskService{
		processingTasks:  make(map[string]struct{}),
		knowledgeService: knowledgeService,
		taskRepo:         taskRepo,
		taskQueue:        queue,
		taskLocker:       NewNoopImportTaskLocker(),
		stopCh:           make(chan struct{}),
		stoppedCh:        make(chan struct{}),
		maxAttempts:      3,
		retryDelay:       2 * time.Second,
		retryBackoffMode: "fixed",
		retryMaxDelay:    30 * time.Second,
		taskLockTTL:      60 * time.Second,
		ackRetryCount:    2,
		ackRetryInterval: 200 * time.Millisecond,
	}
}

func (s *ImportTaskService) SetTaskLocker(locker ImportTaskLocker) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if locker == nil {
		s.taskLocker = NewNoopImportTaskLocker()
		return
	}
	s.taskLocker = locker
}

func (s *ImportTaskService) SetTaskLockTTL(ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ttl <= 0 {
		s.taskLockTTL = 60 * time.Second
		return
	}
	s.taskLockTTL = ttl
}

func (s *ImportTaskService) SetAckRetryPolicy(retryCount int, retryInterval time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if retryCount < 0 {
		retryCount = 0
	}
	if retryInterval <= 0 {
		retryInterval = 200 * time.Millisecond
	}
	s.ackRetryCount = retryCount
	s.ackRetryInterval = retryInterval
}

func (s *ImportTaskService) SetTaskRetryPolicy(maxAttempts int, retryDelay time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if maxAttempts <= 0 {
		maxAttempts = 3
	}
	if retryDelay <= 0 {
		retryDelay = 2 * time.Second
	}
	s.maxAttempts = maxAttempts
	s.retryDelay = retryDelay
}

func (s *ImportTaskService) SetTaskRetryBackoffPolicy(mode string, maxDelay time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "exponential" {
		mode = "fixed"
	}
	if maxDelay <= 0 {
		maxDelay = 30 * time.Second
	}
	s.retryBackoffMode = mode
	s.retryMaxDelay = maxDelay
}

func (s *ImportTaskService) StartWorker() {
	s.mu.Lock()
	if s.workerStarted {
		s.mu.Unlock()
		return
	}
	s.workerStarted = true
	s.mu.Unlock()

	go func() {
		defer close(s.stoppedCh)
		for {
			message, ok := s.taskQueue.Dequeue(s.stopCh)
			if !ok {
				return
			}
			s.mu.Lock()
			s.stats.Dequeued++
			if message.Source == "claim" {
				s.stats.ClaimedMessageCount++
			}
			if message.Source == "new" {
				s.stats.StreamMessageCount++
			}
			s.mu.Unlock()
			_, processed, err := s.processOneAttempt(message.TaskUID)
			if err != nil {
				continue
			}
			if processed {
				if err := s.ackWithRetry(message.Receipt); err != nil {
					s.mu.Lock()
					s.stats.AckErrorCount++
					s.stats.AckRetryExhaustedCount++
					s.mu.Unlock()
				} else {
					s.mu.Lock()
					s.stats.AckSuccessCount++
					s.mu.Unlock()
				}
			}
		}
	}()
}

func (s *ImportTaskService) StopWorker() {
	s.mu.Lock()
	if !s.workerStarted {
		s.mu.Unlock()
		return
	}
	s.workerStarted = false
	close(s.stopCh)
	s.taskQueue.Close()
	s.mu.Unlock()
	<-s.stoppedCh
}

func (s *ImportTaskService) CreateTask(req ImportTaskRequest) (ImportTask, error) {
	dedupKey := buildRequestDedupKey(req)
	if existingTask, exists, err := s.taskRepo.FindTaskByDedupKey(dedupKey); err != nil {
		return ImportTask{}, err
	} else if exists {
		s.mu.Lock()
		s.stats.DeduplicatedCreateCount++
		s.mu.Unlock()
		return existingTask, nil
	}

	now := time.Now()
	task := ImportTask{
		TaskUID:     idgen.New("kbt"),
		Status:      ImportTaskQueued,
		Request:     req,
		DedupKey:    dedupKey,
		Attempts:    0,
		MaxAttempts: s.maxAttempts,
		CreatedAt:   now,
	}
	if err := s.taskRepo.SaveTask(task); err != nil {
		return ImportTask{}, err
	}
	s.mu.Lock()
	s.stats.TotalCreated++
	s.enqueueLocked(task.TaskUID)
	s.mu.Unlock()
	return task, nil
}

func (s *ImportTaskService) GetTask(taskUID string) (ImportTask, bool, error) {
	return s.taskRepo.FindTask(taskUID)
}

func (s *ImportTaskService) RunTask(taskUID string) (ImportTask, bool, error) {
	s.mu.Lock()
	s.stats.ManualRunCount++
	s.mu.Unlock()
	return s.processOneAttempt(taskUID)
}

func (s *ImportTaskService) EnqueueTask(taskUID string) (ImportTask, bool, error) {
	task, ok, err := s.taskRepo.FindTask(taskUID)
	if err != nil || !ok {
		return ImportTask{}, ok, err
	}
	task.Status = ImportTaskQueued
	if err := s.taskRepo.SaveTask(task); err != nil {
		return ImportTask{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats.ManualEnqueueCount++
	s.enqueueLocked(taskUID)
	return task, true, nil
}

func (s *ImportTaskService) RetryTask(taskUID string) (ImportTask, bool, error) {
	return s.RetryTaskStrict(taskUID)
}

func (s *ImportTaskService) RetryTaskStrict(taskUID string) (ImportTask, bool, error) {
	task, ok, err := s.taskRepo.FindTask(taskUID)
	if err != nil || !ok {
		return ImportTask{}, ok, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !(task.Status == ImportTaskFailed && task.Attempts >= task.MaxAttempts) {
		s.stats.ManualRetryRejectedCount++
		return task, true, errors.New("task is not in dead-letter state")
	}
	task.Status = ImportTaskQueued
	task.Attempts = 0
	task.NextRunAt = nil
	task.LastErrorAt = nil
	task.ErrorMessage = ""
	task.StartedAt = nil
	task.FinishedAt = nil
	if err := s.taskRepo.SaveTask(task); err != nil {
		return ImportTask{}, false, err
	}
	if err := s.taskRepo.DeleteDeadLettersByTaskUID(taskUID); err != nil {
		return ImportTask{}, false, err
	}
	s.stats.ManualRetryCount++
	s.refreshDeadLetterCountLocked()
	s.enqueueLocked(taskUID)
	return task, true, nil
}

func (s *ImportTaskService) processOneAttempt(taskUID string) (ImportTask, bool, error) {
	cfg := s.runtimeConfig()
	locked, lockErr := cfg.locker.TryLock(taskUID, cfg.lockTTL)
	if lockErr != nil {
		s.mu.Lock()
		s.stats.LockErrorCount++
		s.mu.Unlock()
		return ImportTask{}, false, lockErr
	}
	if !locked {
		s.mu.Lock()
		s.stats.LockConflictCount++
		s.mu.Unlock()
		task, ok, err := s.taskRepo.FindTask(taskUID)
		return task, ok, err
	}
	defer func() {
		_ = cfg.locker.Unlock(taskUID)
	}()

	return s.withTaskProcessing(taskUID, func() (ImportTask, bool, error) {
		task, ok, err := s.taskRepo.FindTask(taskUID)
		if err != nil {
			return ImportTask{}, false, err
		}
		if !ok {
			return ImportTask{}, false, nil
		}
		if task.Status == ImportTaskSucceeded {
			return task, true, nil
		}
		if task.Status == ImportTaskFailed && task.Attempts >= task.MaxAttempts {
			return task, true, nil
		}

		task, err = s.startTaskAttempt(task)
		if err != nil {
			return ImportTask{}, false, err
		}

		content, err := resolveImportContent(task.Request)
		s.mu.Lock()
		defer s.mu.Unlock()
		defer s.finishRunningTaskLocked()

		current, exists, repoErr := s.taskRepo.FindTask(taskUID)
		if repoErr != nil {
			return ImportTask{}, false, repoErr
		}
		if !exists {
			return ImportTask{}, false, nil
		}
		finished := time.Now()
		current.FinishedAt = &finished
		if err != nil {
			if current.Attempts < current.MaxAttempts {
				current, err = s.scheduleRetry(current, taskUID, finished, err)
				if err != nil {
					return ImportTask{}, false, err
				}
				return current, true, nil
			}
			current, err = s.moveToDeadLetter(current, finished, err)
			if err != nil {
				return ImportTask{}, false, err
			}
			return current, true, nil
		}

		result, importErr := s.knowledgeService.Import(ImportRequest{
			KBType:     task.Request.KBType,
			Title:      task.Request.Title,
			SourceType: task.Request.SourceType,
			SourceRef:  task.Request.SourceRef,
			Lang:       task.Request.Lang,
			Content:    content,
		})
		if importErr != nil {
			current, err = s.moveToDeadLetter(current, finished, importErr)
			if err != nil {
				return ImportTask{}, false, err
			}
			return current, true, nil
		}
		current, err = s.completeSuccessfulImport(current, result)
		if err != nil {
			return ImportTask{}, false, err
		}
		return current, true, nil
	})
}

func (s *ImportTaskService) enqueueAfter(taskUID string, delay time.Duration) {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-s.stopCh:
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok, err := s.taskRepo.FindTask(taskUID); err != nil || !ok {
		return
	}
	s.enqueueLocked(taskUID)
}

func (s *ImportTaskService) computeRetryDelay(attempt int) time.Duration {
	cfg := s.runtimeConfig()
	return computeRetryDelayByPolicy(cfg.retryDelay, cfg.retryBackoffMode, cfg.retryMaxDelay, attempt)
}

func (s *ImportTaskService) computeRetryDelayLocked(attempt int) time.Duration {
	return computeRetryDelayByPolicy(s.retryDelay, s.retryBackoffMode, s.retryMaxDelay, attempt)
}

func (s *ImportTaskService) enqueueLocked(taskUID string) {
	if s.taskQueue.Enqueue(taskUID) {
		s.stats.QueuePushAccepted++
		return
	}
	s.stats.QueuePushDropped++
}

func (s *ImportTaskService) ackWithRetry(receipt string) error {
	retryCount, retryInterval := s.ackRetryConfig()
	err := s.taskQueue.Ack(receipt)
	if err == nil {
		return nil
	}
	for attempt := 0; attempt < retryCount; attempt++ {
		time.Sleep(retryInterval)
		s.mu.Lock()
		s.stats.AckRetryCount++
		s.mu.Unlock()
		err = s.taskQueue.Ack(receipt)
		if err == nil {
			return nil
		}
	}
	return err
}

func (s *ImportTaskService) Stats() ImportTaskStats {
	pendingCount := int64(0)
	if queueRuntime, ok := s.taskQueue.(ImportTaskQueueRuntime); ok {
		if count, err := queueRuntime.PendingCount(); err == nil {
			pendingCount = count
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	current := s.stats
	current.QueuePendingCount = pendingCount
	return current
}

func (s *ImportTaskService) ListDeadLetters(limit int) []DeadLetterRecord {
	out, err := s.taskRepo.ListDeadLetters(limit)
	if err != nil {
		return nil
	}
	return out
}

func (s *ImportTaskService) refreshDeadLetterCountLocked() {
	count, err := s.taskRepo.CountDeadLetters()
	if err == nil {
		s.stats.DeadLetterCount = count
	}
}

func buildRequestDedupKey(req ImportTaskRequest) string {
	if key := strings.TrimSpace(req.IdempotencyKey); key != "" {
		return "idem:" + key
	}
	contentHash := hashString(strings.TrimSpace(req.Content))
	filePath := strings.TrimSpace(req.FilePath)
	return fmt.Sprintf(
		"auto:%s|%s|%s|%s|%s|%s",
		strings.TrimSpace(req.KBType),
		strings.TrimSpace(req.SourceType),
		strings.TrimSpace(req.SourceRef),
		strings.TrimSpace(req.Lang),
		contentHash,
		filePath,
	)
}

func hashString(value string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(value))
	return fmt.Sprintf("%x", h.Sum64())
}
