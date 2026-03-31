package postgres

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	domainllm "lceda_ai/server/internal/domain/llm"
)

type LLMLogRepository struct {
	pool *pgxpool.Pool
}

func NewLLMLogRepository(pool *pgxpool.Pool) *LLMLogRepository {
	return &LLMLogRepository{pool: pool}
}

func (r *LLMLogRepository) SaveLog(log domainllm.RequestLog) error {
	if r.pool == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := r.pool.Exec(ctx, `
		INSERT INTO llm_request_logs (
			request_uid, user_id, scene, billing_mode, provider, model, request_tokens,
			response_tokens, total_tokens, latency_ms, status, error_code, cost_credits,
			request_payload, response_summary, created_at
		)
		VALUES (
			$1,
			(SELECT id FROM users WHERE user_uid = $2 LIMIT 1),
			$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16
		)
		ON CONFLICT (request_uid) DO UPDATE
		SET status = EXCLUDED.status,
		    error_code = EXCLUDED.error_code,
		    response_summary = EXCLUDED.response_summary,
		    latency_ms = EXCLUDED.latency_ms
	`, log.RequestID, nullable(log.UserID), log.Scene, log.BillingMode, log.Provider, log.Model,
		log.RequestTokens, log.ResponseTokens, log.TotalTokens, log.LatencyMs, log.Status,
		nullable(log.ErrorCode), log.CostCredits, mustJSON(map[string]any{}), mustJSON(map[string]string{"summary": log.ResponseSummary}), log.CreatedAt)
	return err
}

func (r *LLMLogRepository) ListLogs(userID string, limit int) []domainllm.RequestLog {
	if r.pool == nil {
		return nil
	}
	if limit <= 0 {
		limit = 20
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := r.pool.Query(ctx, `
		SELECT l.request_uid, COALESCE(u.user_uid, ''), l.scene, l.billing_mode, l.provider, l.model,
		       l.request_tokens, l.response_tokens, l.total_tokens, l.latency_ms, l.status,
		       COALESCE(l.error_code, ''), l.cost_credits,
		       COALESCE(l.response_summary->>'summary', ''), l.created_at
		FROM llm_request_logs l
		LEFT JOIN users u ON u.id = l.user_id
		WHERE ($1 = '' OR u.user_uid = $1)
		ORDER BY l.created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]domainllm.RequestLog, 0)
	for rows.Next() {
		var item domainllm.RequestLog
		if rows.Scan(
			&item.RequestID,
			&item.UserID,
			&item.Scene,
			&item.BillingMode,
			&item.Provider,
			&item.Model,
			&item.RequestTokens,
			&item.ResponseTokens,
			&item.TotalTokens,
			&item.LatencyMs,
			&item.Status,
			&item.ErrorCode,
			&item.CostCredits,
			&item.ResponseSummary,
			&item.CreatedAt,
		) == nil {
			out = append(out, item)
		}
	}
	return out
}

func mustJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(raw)
}
