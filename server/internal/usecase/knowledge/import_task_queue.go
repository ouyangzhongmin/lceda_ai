package knowledge

import "sync"

type ImportTaskQueue interface {
	Enqueue(taskUID string) bool
	Dequeue(stop <-chan struct{}) (ImportTaskMessage, bool)
	Ack(receipt string) error
	Close()
}

type ImportTaskMessage struct {
	TaskUID  string
	Receipt  string
	Source   string
}

type ImportTaskQueueRuntime interface {
	PendingCount() (int64, error)
}

type InMemoryImportTaskQueue struct {
	ch        chan string
	closeOnce sync.Once
}

func NewInMemoryImportTaskQueue(bufferSize int) *InMemoryImportTaskQueue {
	if bufferSize <= 0 {
		bufferSize = 256
	}
	return &InMemoryImportTaskQueue{
		ch: make(chan string, bufferSize),
	}
}

func (q *InMemoryImportTaskQueue) Enqueue(taskUID string) bool {
	select {
	case q.ch <- taskUID:
		return true
	default:
		return false
	}
}

func (q *InMemoryImportTaskQueue) Dequeue(stop <-chan struct{}) (ImportTaskMessage, bool) {
	select {
	case <-stop:
		return ImportTaskMessage{}, false
	case taskUID, ok := <-q.ch:
		if !ok {
			return ImportTaskMessage{}, false
		}
		return ImportTaskMessage{
			TaskUID: taskUID,
			Source:  "queue",
		}, true
	}
}

func (q *InMemoryImportTaskQueue) Ack(_ string) error {
	return nil
}

func (q *InMemoryImportTaskQueue) PendingCount() (int64, error) {
	return int64(len(q.ch)), nil
}

func (q *InMemoryImportTaskQueue) Close() {
	q.closeOnce.Do(func() {
		close(q.ch)
	})
}
