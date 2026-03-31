package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	domainknowledge "lceda_ai/server/internal/domain/knowledge"
)

type KnowledgeRepository struct {
	pool *pgxpool.Pool
}

func NewKnowledgeRepository(pool *pgxpool.Pool) *KnowledgeRepository {
	return &KnowledgeRepository{pool: pool}
}

func (r *KnowledgeRepository) FindDocumentBySourceKey(sourceKey string) (domainknowledge.Document, bool) {
	if r.pool == nil || sourceKey == "" {
		return domainknowledge.Document{}, false
	}
	kbType, sourceType, sourceRef, lang, ok := parseSourceKey(sourceKey)
	if !ok {
		return domainknowledge.Document{}, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	document, err := r.queryDocument(ctx, `
		SELECT document_uid, kb_type, title, source_type, COALESCE(source_ref, ''), lang, status, created_at, updated_at
		FROM knowledge_documents
		WHERE kb_type = $1 AND source_type = $2 AND source_ref = $3 AND lang = $4
		LIMIT 1
	`, kbType, sourceType, sourceRef, lang)
	if err != nil {
		return domainknowledge.Document{}, false
	}
	document.ChunkCount = r.countChunks(ctx, document.DocumentUID)
	return document, true
}

func (r *KnowledgeRepository) FindContentHash(documentUID string) (uint64, bool) {
	if r.pool == nil {
		return 0, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var checksum uint64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE((meta->>'content_hash')::bigint, 0)
		FROM knowledge_documents
		WHERE document_uid = $1
		LIMIT 1
	`, documentUID).Scan(&checksum)
	if err != nil {
		return 0, false
	}
	return checksum, true
}

func (r *KnowledgeRepository) SaveDocument(document domainknowledge.Document, _ string, contentHash uint64) error {
	if r.pool == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	insertMetaExpr := "'{}'::jsonb"
	updateMetaExpr := "knowledge_documents.meta"
	args := []any{
		document.DocumentUID,
		document.KBType,
		document.Title,
		document.SourceType,
		nullable(document.SourceRef),
		nonEmptyOr(document.Lang, "zh-CN"),
		nonEmptyOr(document.Status, "active"),
		document.CreatedAt,
		document.UpdatedAt,
	}
	if contentHash > 0 {
		insertMetaExpr = "$10::jsonb"
		updateMetaExpr = "$10::jsonb"
		args = append(args, mustJSON(map[string]string{"content_hash": fmt.Sprintf("%d", contentHash)}))
	}

	_, err := r.pool.Exec(ctx, `
		INSERT INTO knowledge_documents (
			document_uid, kb_type, title, source_type, source_ref, lang, status, meta, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, `+insertMetaExpr+`, $8, $9
		)
		ON CONFLICT (document_uid) DO UPDATE
		SET kb_type = EXCLUDED.kb_type,
		    title = EXCLUDED.title,
		    source_type = EXCLUDED.source_type,
		    source_ref = EXCLUDED.source_ref,
		    lang = EXCLUDED.lang,
		    status = EXCLUDED.status,
		    meta = `+updateMetaExpr+`,
		    updated_at = EXCLUDED.updated_at
	`, args...)
	return err
}

func (r *KnowledgeRepository) FindDocument(documentUID string) (domainknowledge.Document, bool) {
	if r.pool == nil {
		return domainknowledge.Document{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	document, err := r.queryDocument(ctx, `
		SELECT document_uid, kb_type, title, source_type, COALESCE(source_ref, ''), lang, status, created_at, updated_at
		FROM knowledge_documents
		WHERE document_uid = $1
		LIMIT 1
	`, documentUID)
	if err != nil {
		return domainknowledge.Document{}, false
	}
	document.ChunkCount = r.countChunks(ctx, document.DocumentUID)
	return document, true
}

func (r *KnowledgeRepository) ListDocuments(limit int) []domainknowledge.Document {
	if r.pool == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if limit <= 0 {
		limit = 20
	}
	rows, err := r.pool.Query(ctx, `
		SELECT kd.document_uid, kd.kb_type, kd.title, kd.source_type, COALESCE(kd.source_ref, ''), kd.lang, kd.status,
		       kd.created_at, kd.updated_at, COUNT(kc.id)::int AS chunk_count
		FROM knowledge_documents kd
		LEFT JOIN knowledge_document_chunks kc ON kc.document_id = kd.id
		GROUP BY kd.id
		ORDER BY kd.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]domainknowledge.Document, 0)
	for rows.Next() {
		var item domainknowledge.Document
		var chunkCount int32
		if rows.Scan(
			&item.DocumentUID,
			&item.KBType,
			&item.Title,
			&item.SourceType,
			&item.SourceRef,
			&item.Lang,
			&item.Status,
			&item.CreatedAt,
			&item.UpdatedAt,
			&chunkCount,
		) == nil {
			item.ChunkCount = int(chunkCount)
			out = append(out, item)
		}
	}
	return out
}

func (r *KnowledgeRepository) SaveChunks(documentUID string, chunks []domainknowledge.Chunk) error {
	if r.pool == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var documentID int64
	if err := tx.QueryRow(ctx, `SELECT id FROM knowledge_documents WHERE document_uid = $1`, documentUID).Scan(&documentID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM knowledge_document_chunks WHERE document_id = $1`, documentID); err != nil {
		return err
	}

	for _, chunk := range chunks {
		status := chunk.QdrantStatus
		if status == "" {
			status = "pending"
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO knowledge_document_chunks (
				chunk_uid, document_id, qdrant_collection, qdrant_point_id, chunk_index,
				content_text, token_count, status, created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
		`, chunk.ChunkUID, documentID, "default", nonEmptyOr(chunk.QdrantPoint, chunk.ChunkUID), chunk.ChunkIndex,
			chunk.Content, chunk.TokenCount, status); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *KnowledgeRepository) ListChunks(documentUID string) []domainknowledge.Chunk {
	if r.pool == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := r.pool.Query(ctx, `
		SELECT kc.chunk_uid, kd.document_uid, kc.chunk_index, kc.content_text, kc.token_count, kc.qdrant_point_id, kc.status
		FROM knowledge_document_chunks kc
		JOIN knowledge_documents kd ON kd.id = kc.document_id
		WHERE kd.document_uid = $1
		ORDER BY kc.chunk_index ASC
	`, documentUID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]domainknowledge.Chunk, 0)
	for rows.Next() {
		var item domainknowledge.Chunk
		if rows.Scan(
			&item.ChunkUID,
			&item.DocumentUID,
			&item.ChunkIndex,
			&item.Content,
			&item.TokenCount,
			&item.QdrantPoint,
			&item.QdrantStatus,
		) == nil {
			out = append(out, item)
		}
	}
	return out
}

func (r *KnowledgeRepository) queryDocument(ctx context.Context, sql string, args ...any) (domainknowledge.Document, error) {
	var item domainknowledge.Document
	err := r.pool.QueryRow(ctx, sql, args...).Scan(
		&item.DocumentUID,
		&item.KBType,
		&item.Title,
		&item.SourceType,
		&item.SourceRef,
		&item.Lang,
		&item.Status,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	return item, err
}

func (r *KnowledgeRepository) countChunks(ctx context.Context, documentUID string) int {
	var count int
	_ = r.pool.QueryRow(ctx, `
		SELECT COUNT(kc.id)
		FROM knowledge_document_chunks kc
		JOIN knowledge_documents kd ON kd.id = kc.document_id
		WHERE kd.document_uid = $1
	`, documentUID).Scan(&count)
	return count
}

func parseSourceKey(sourceKey string) (string, string, string, string, bool) {
	parts := [4]string{}
	index := 0
	start := 0
	for i := 0; i < len(sourceKey); i++ {
		if sourceKey[i] == '|' {
			if index >= 4 {
				return "", "", "", "", false
			}
			parts[index] = sourceKey[start:i]
			index++
			start = i + 1
		}
	}
	if index != 3 {
		return "", "", "", "", false
	}
	parts[3] = sourceKey[start:]
	return parts[0], parts[1], parts[2], parts[3], true
}
