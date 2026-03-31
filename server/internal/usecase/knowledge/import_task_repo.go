package knowledge

import (
	"errors"
	"sort"
	"sync"
)

var ErrTaskRepositoryUnavailable = errors.New("import task repository unavailable")

type ImportTaskRepository interface {
	SaveTask(task ImportTask) error
	FindTask(taskUID string) (ImportTask, bool, error)
	FindTaskByDedupKey(dedupKey string) (ImportTask, bool, error)
	AppendDeadLetter(record DeadLetterRecord) error
	DeleteDeadLettersByTaskUID(taskUID string) error
	ListDeadLetters(limit int) ([]DeadLetterRecord, error)
	CountDeadLetters() (int, error)
}

type InMemoryImportTaskRepository struct {
	mu           sync.RWMutex
	tasks        map[string]ImportTask
	requestIndex map[string]string
	deadLetters  []DeadLetterRecord
}

func NewInMemoryImportTaskRepository() *InMemoryImportTaskRepository {
	return &InMemoryImportTaskRepository{
		tasks:        make(map[string]ImportTask),
		requestIndex: make(map[string]string),
		deadLetters:  make([]DeadLetterRecord, 0, 64),
	}
}

func (r *InMemoryImportTaskRepository) SaveTask(task ImportTask) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tasks[task.TaskUID] = task
	if task.DedupKey != "" {
		r.requestIndex[task.DedupKey] = task.TaskUID
	}
	return nil
}

func (r *InMemoryImportTaskRepository) FindTask(taskUID string) (ImportTask, bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	task, ok := r.tasks[taskUID]
	return task, ok, nil
}

func (r *InMemoryImportTaskRepository) FindTaskByDedupKey(dedupKey string) (ImportTask, bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	taskUID, ok := r.requestIndex[dedupKey]
	if !ok {
		return ImportTask{}, false, nil
	}
	task, exists := r.tasks[taskUID]
	return task, exists, nil
}

func (r *InMemoryImportTaskRepository) AppendDeadLetter(record DeadLetterRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deadLetters = append(r.deadLetters, record)
	return nil
}

func (r *InMemoryImportTaskRepository) DeleteDeadLettersByTaskUID(taskUID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	filtered := r.deadLetters[:0]
	for _, item := range r.deadLetters {
		if item.TaskUID != taskUID {
			filtered = append(filtered, item)
		}
	}
	r.deadLetters = filtered
	return nil
}

func (r *InMemoryImportTaskRepository) ListDeadLetters(limit int) ([]DeadLetterRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if len(r.deadLetters) == 0 {
		return nil, nil
	}
	start := 0
	if len(r.deadLetters) > limit {
		start = len(r.deadLetters) - limit
	}
	out := make([]DeadLetterRecord, len(r.deadLetters[start:]))
	copy(out, r.deadLetters[start:])
	sort.Slice(out, func(i, j int) bool {
		return out[i].FailedAt.Before(out[j].FailedAt)
	})
	return out, nil
}

func (r *InMemoryImportTaskRepository) CountDeadLetters() (int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.deadLetters), nil
}
