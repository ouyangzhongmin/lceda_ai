package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	httptransport "lceda_ai/server/internal/transport/http"
)

type RequestLogRepository struct {
	pool *pgxpool.Pool
}

func NewRequestLogRepository(pool *pgxpool.Pool) *RequestLogRepository {
	return &RequestLogRepository{pool: pool}
}

func (r *RequestLogRepository) Save(entry httptransport.RequestLogEntry) error {
	if r.pool == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	args := requestLogInsertArgs(entry)
	_, err := r.pool.Exec(ctx, `
		INSERT INTO request_logs (
			request_uid, user_id, path, method, status_code, client_ip, user_agent, latency_ms, error_code, created_at
		)
		VALUES (
			$1, (SELECT id FROM users WHERE user_uid = $2 LIMIT 1), $3, $4, $5, NULLIF($6, '')::inet, $7, $8, NULLIF($9, ''), $10
		)
	`, args...)
	return err
}

func requestLogInsertArgs(entry httptransport.RequestLogEntry) []any {
	return []any{
		entry.RequestID,
		nullable(entry.UserID),
		entry.Path,
		entry.Method,
		entry.StatusCode,
		entry.ClientIP,
		entry.UserAgent,
		entry.LatencyMS,
		entry.ErrorCode,
		entry.CreatedAt,
	}
}
