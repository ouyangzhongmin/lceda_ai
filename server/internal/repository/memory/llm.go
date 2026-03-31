package memory

import (
	"sync"

	domainllm "lceda_ai/server/internal/domain/llm"
)

type LLMLogRepository struct {
	mu   sync.RWMutex
	logs []domainllm.RequestLog
}

func NewLLMLogRepository() *LLMLogRepository {
	return &LLMLogRepository{logs: []domainllm.RequestLog{}}
}

func (r *LLMLogRepository) SaveLog(log domainllm.RequestLog) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.logs = append([]domainllm.RequestLog{log}, r.logs...)
	return nil
}

func (r *LLMLogRepository) ListLogs(userID string, limit int) []domainllm.RequestLog {
	r.mu.RLock()
	defer r.mu.RUnlock()
	filtered := make([]domainllm.RequestLog, 0, len(r.logs))
	for _, item := range r.logs {
		if item.UserID == userID {
			filtered = append(filtered, item)
		}
	}
	if limit <= 0 || limit > len(filtered) {
		limit = len(filtered)
	}
	out := make([]domainllm.RequestLog, limit)
	copy(out, filtered[:limit])
	return out
}
