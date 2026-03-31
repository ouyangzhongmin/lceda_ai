package knowledge

import "time"

type ImportTaskLocker interface {
	TryLock(taskUID string, ttl time.Duration) (bool, error)
	Unlock(taskUID string) error
}

type NoopImportTaskLocker struct{}

func NewNoopImportTaskLocker() *NoopImportTaskLocker {
	return &NoopImportTaskLocker{}
}

func (l *NoopImportTaskLocker) TryLock(_ string, _ time.Duration) (bool, error) {
	return true, nil
}

func (l *NoopImportTaskLocker) Unlock(_ string) error {
	return nil
}
