package postgres

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
)

type ImportTaskRepository struct {
	pool *pgxpool.Pool
}

func NewImportTaskRepository(pool *pgxpool.Pool) *ImportTaskRepository {
	return &ImportTaskRepository{pool: pool}
}

func (r *ImportTaskRepository) SaveTask(task knowledgeusecase.ImportTask) error {
	if r.pool == nil {
		return knowledgeusecase.ErrTaskRepositoryUnavailable
	}
	requestPayload, err := json.Marshal(task.Request)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err = r.pool.Exec(ctx, `
		INSERT INTO knowledge_import_tasks (
			task_uid, status, request_payload, dedup_key, attempts, max_attempts, next_run_at,
			last_error_at, document_uid, import_mode, chunk_count, error_message,
			created_at, started_at, finished_at
		) VALUES (
			$1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		)
		ON CONFLICT (task_uid) DO UPDATE
		SET status = EXCLUDED.status,
		    request_payload = EXCLUDED.request_payload,
		    dedup_key = EXCLUDED.dedup_key,
		    attempts = EXCLUDED.attempts,
		    max_attempts = EXCLUDED.max_attempts,
		    next_run_at = EXCLUDED.next_run_at,
		    last_error_at = EXCLUDED.last_error_at,
		    document_uid = EXCLUDED.document_uid,
		    import_mode = EXCLUDED.import_mode,
		    chunk_count = EXCLUDED.chunk_count,
		    error_message = EXCLUDED.error_message,
		    started_at = EXCLUDED.started_at,
		    finished_at = EXCLUDED.finished_at,
		    updated_at = NOW()
	`, task.TaskUID, string(task.Status), requestPayload, nullable(task.DedupKey), task.Attempts, task.MaxAttempts,
		task.NextRunAt, task.LastErrorAt, nullable(task.DocumentUID), nullable(string(task.ImportMode)),
		task.ChunkCount, nullable(task.ErrorMessage), task.CreatedAt, task.StartedAt, task.FinishedAt)
	return err
}

func (r *ImportTaskRepository) FindTask(taskUID string) (knowledgeusecase.ImportTask, bool, error) {
	if r.pool == nil {
		return knowledgeusecase.ImportTask{}, false, knowledgeusecase.ErrTaskRepositoryUnavailable
	}
	return r.findOne(`SELECT task_uid, status, request_payload, COALESCE(dedup_key, ''), attempts, max_attempts,
		next_run_at, last_error_at, COALESCE(document_uid, ''), COALESCE(import_mode, ''), chunk_count,
		COALESCE(error_message, ''), created_at, started_at, finished_at
		FROM knowledge_import_tasks WHERE task_uid = $1 LIMIT 1`, taskUID)
}

func (r *ImportTaskRepository) FindTaskByDedupKey(dedupKey string) (knowledgeusecase.ImportTask, bool, error) {
	if r.pool == nil {
		return knowledgeusecase.ImportTask{}, false, knowledgeusecase.ErrTaskRepositoryUnavailable
	}
	return r.findOne(`SELECT task_uid, status, request_payload, COALESCE(dedup_key, ''), attempts, max_attempts,
		next_run_at, last_error_at, COALESCE(document_uid, ''), COALESCE(import_mode, ''), chunk_count,
		COALESCE(error_message, ''), created_at, started_at, finished_at
		FROM knowledge_import_tasks WHERE dedup_key = $1 LIMIT 1`, dedupKey)
}

func (r *ImportTaskRepository) AppendDeadLetter(record knowledgeusecase.DeadLetterRecord) error {
	if r.pool == nil {
		return knowledgeusecase.ErrTaskRepositoryUnavailable
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := r.pool.Exec(ctx, `
		INSERT INTO knowledge_import_dead_letters (task_uid, error_message, attempts, max_attempts, failed_at)
		VALUES ($1, $2, $3, $4, $5)
	`, record.TaskUID, record.ErrorMessage, record.Attempts, record.MaxAttempts, record.FailedAt)
	return err
}

func (r *ImportTaskRepository) DeleteDeadLettersByTaskUID(taskUID string) error {
	if r.pool == nil {
		return knowledgeusecase.ErrTaskRepositoryUnavailable
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := r.pool.Exec(ctx, `DELETE FROM knowledge_import_dead_letters WHERE task_uid = $1`, taskUID)
	return err
}

func (r *ImportTaskRepository) ListDeadLetters(limit int) ([]knowledgeusecase.DeadLetterRecord, error) {
	if r.pool == nil {
		return nil, knowledgeusecase.ErrTaskRepositoryUnavailable
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	rows, err := r.pool.Query(ctx, `
		SELECT task_uid, error_message, attempts, max_attempts, failed_at
		FROM knowledge_import_dead_letters
		ORDER BY failed_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]knowledgeusecase.DeadLetterRecord, 0)
	for rows.Next() {
		var item knowledgeusecase.DeadLetterRecord
		if err := rows.Scan(&item.TaskUID, &item.ErrorMessage, &item.Attempts, &item.MaxAttempts, &item.FailedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *ImportTaskRepository) CountDeadLetters() (int, error) {
	if r.pool == nil {
		return 0, knowledgeusecase.ErrTaskRepositoryUnavailable
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var count int
	if err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM knowledge_import_dead_letters`).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (r *ImportTaskRepository) findOne(sql string, arg any) (knowledgeusecase.ImportTask, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var (
		task        knowledgeusecase.ImportTask
		status      string
		requestBody []byte
		importMode  string
	)
	err := r.pool.QueryRow(ctx, sql, arg).Scan(
		&task.TaskUID,
		&status,
		&requestBody,
		&task.DedupKey,
		&task.Attempts,
		&task.MaxAttempts,
		&task.NextRunAt,
		&task.LastErrorAt,
		&task.DocumentUID,
		&importMode,
		&task.ChunkCount,
		&task.ErrorMessage,
		&task.CreatedAt,
		&task.StartedAt,
		&task.FinishedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return knowledgeusecase.ImportTask{}, false, nil
		}
		return knowledgeusecase.ImportTask{}, false, err
	}
	if err := json.Unmarshal(requestBody, &task.Request); err != nil {
		return knowledgeusecase.ImportTask{}, false, err
	}
	task.Status = knowledgeusecase.ImportTaskStatus(status)
	task.ImportMode = knowledgeusecase.ImportMode(importMode)
	return task, true, nil
}
