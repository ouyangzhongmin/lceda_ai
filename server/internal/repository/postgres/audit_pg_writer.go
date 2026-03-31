package postgres

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PGAuditWriter struct {
	pool    *pgxpool.Pool
	timeout time.Duration
}

func NewPGAuditWriter(pool *pgxpool.Pool) *PGAuditWriter {
	return &PGAuditWriter{
		pool:    pool,
		timeout: 3 * time.Second,
	}
}

func (w *PGAuditWriter) Write(event map[string]any) error {
	if w.pool == nil {
		return nil
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	eventType := ""
	if raw, ok := event["event_type"].(string); ok {
		eventType = raw
	}
	userID := ""
	if raw, ok := event["user_id"].(string); ok {
		userID = raw
	}
	requestID := ""
	if raw, ok := event["request_id"].(string); ok {
		requestID = raw
	}

	ctx, cancel := context.WithTimeout(context.Background(), w.timeout)
	defer cancel()
	_, err = w.pool.Exec(
		ctx,
		`INSERT INTO audit_events (event_type, user_id, request_uid, payload, created_at)
		 VALUES ($1, $2, $3, $4::jsonb, NOW())`,
		eventType,
		nullable(userID),
		nullable(requestID),
		string(payload),
	)
	return err
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}
