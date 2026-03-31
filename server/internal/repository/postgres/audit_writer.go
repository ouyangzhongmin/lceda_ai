package postgres

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type AuditWriter interface {
	Write(event map[string]any) error
}

type JSONLAuditWriter struct {
	mu   sync.Mutex
	path string
}

func NewJSONLAuditWriter(path string) *JSONLAuditWriter {
	return &JSONLAuditWriter{
		path: path,
	}
}

func (w *JSONLAuditWriter) Write(event map[string]any) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.path == "" {
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(w.path), 0o755); err != nil {
		return err
	}

	if _, ok := event["created_at"]; !ok {
		event["created_at"] = time.Now().Format(time.RFC3339Nano)
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	payload = append(payload, '\n')

	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = file.Write(payload)
	return err
}

type FailoverAuditWriter struct {
	primary  AuditWriter
	fallback AuditWriter
}

func NewFailoverAuditWriter(primary AuditWriter, fallback AuditWriter) *FailoverAuditWriter {
	return &FailoverAuditWriter{
		primary:  primary,
		fallback: fallback,
	}
}

func (w *FailoverAuditWriter) Write(event map[string]any) error {
	if w.primary != nil {
		if err := w.primary.Write(event); err == nil {
			return nil
		}
	}
	if w.fallback != nil {
		return w.fallback.Write(event)
	}
	return nil
}
