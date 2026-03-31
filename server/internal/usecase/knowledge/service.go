package knowledge

import (
	"hash/fnv"
	"strings"
	"time"

	domainknowledge "lceda_ai/server/internal/domain/knowledge"
	"lceda_ai/server/internal/pkg/idgen"
)

type Document = domainknowledge.Document
type Chunk = domainknowledge.Chunk
type ImportRequest = domainknowledge.ImportRequest
type ReindexResult = domainknowledge.ReindexResult
type ImportMode = domainknowledge.ImportMode
type ImportResult = domainknowledge.ImportResult

const (
	ImportModeCreated          = domainknowledge.ImportModeCreated
	ImportModeUpdated          = domainknowledge.ImportModeUpdated
	ImportModeSkippedDuplicate = domainknowledge.ImportModeSkippedDuplicate
)

type AuditWriter interface {
	Write(event map[string]any) error
}

type Service struct {
	repo        domainknowledge.Repository
	auditWriter AuditWriter
}

func NewService(repo domainknowledge.Repository, auditWriter ...AuditWriter) *Service {
	var writer AuditWriter
	if len(auditWriter) > 0 {
		writer = auditWriter[0]
	}
	return &Service{
		repo:        repo,
		auditWriter: writer,
	}
}

func (s *Service) Import(req ImportRequest) (ImportResult, error) {
	now := time.Now()
	req = normalizeRequest(req)
	sourceKey := buildSourceKey(req)
	contentHash := hashContent(req.Content)

	if sourceKey != "" {
		if doc, ok := s.repo.FindDocumentBySourceKey(sourceKey); ok {
			if existing, exists := s.repo.FindContentHash(doc.DocumentUID); exists && existing == contentHash {
				doc.UpdatedAt = now
				if err := s.repo.SaveDocument(doc, sourceKey, contentHash); err != nil {
					return ImportResult{}, err
				}
				chunks := s.repo.ListChunks(doc.DocumentUID)
				s.writeAudit(map[string]any{
					"event_type":   "knowledge_document_import_skipped_duplicate",
					"document_uid": doc.DocumentUID,
					"kb_type":      doc.KBType,
					"title":        doc.Title,
					"chunk_count":  len(chunks),
					"updated_at":   now.Format(time.RFC3339Nano),
				})
				return ImportResult{
					Document: doc,
					Chunks:   chunks,
					Mode:     ImportModeSkippedDuplicate,
				}, nil
			}

			doc.KBType = req.KBType
			doc.Title = req.Title
			doc.SourceType = req.SourceType
			doc.SourceRef = req.SourceRef
			doc.Lang = req.Lang
			doc.UpdatedAt = now
			chunks := splitContent(doc.DocumentUID, req.Content, 500)
			doc.ChunkCount = len(chunks)
			if err := s.repo.SaveDocument(doc, sourceKey, contentHash); err != nil {
				return ImportResult{}, err
			}
			if err := s.repo.SaveChunks(doc.DocumentUID, chunks); err != nil {
				return ImportResult{}, err
			}
			s.writeAudit(map[string]any{
				"event_type":   "knowledge_document_updated",
				"document_uid": doc.DocumentUID,
				"kb_type":      doc.KBType,
				"title":        doc.Title,
				"chunk_count":  len(chunks),
				"updated_at":   now.Format(time.RFC3339Nano),
			})
			return ImportResult{
				Document: doc,
				Chunks:   chunks,
				Mode:     ImportModeUpdated,
			}, nil
		}
	}

	docUID := idgen.New("doc")
	chunks := splitContent(docUID, req.Content, 500)
	doc := Document{
		DocumentUID: docUID,
		KBType:      req.KBType,
		Title:       req.Title,
		SourceType:  req.SourceType,
		SourceRef:   req.SourceRef,
		Lang:        req.Lang,
		Status:      "active",
		ChunkCount:  len(chunks),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.repo.SaveDocument(doc, sourceKey, contentHash); err != nil {
		return ImportResult{}, err
	}
	if err := s.repo.SaveChunks(docUID, chunks); err != nil {
		return ImportResult{}, err
	}
	s.writeAudit(map[string]any{
		"event_type":   "knowledge_document_imported",
		"document_uid": docUID,
		"kb_type":      doc.KBType,
		"title":        doc.Title,
		"chunk_count":  len(chunks),
		"created_at":   now.Format(time.RFC3339Nano),
	})

	return ImportResult{
		Document: doc,
		Chunks:   chunks,
		Mode:     ImportModeCreated,
	}, nil
}

func (s *Service) ListDocuments(limit int) ([]Document, error) {
	return s.repo.ListDocuments(limit), nil
}

func (s *Service) Reindex(documentUID string) (ReindexResult, bool, error) {
	doc, ok := s.repo.FindDocument(documentUID)
	if !ok {
		return ReindexResult{}, false, nil
	}
	chunks := s.repo.ListChunks(documentUID)
	for index := range chunks {
		chunks[index].QdrantStatus = "indexed"
	}
	if err := s.repo.SaveChunks(documentUID, chunks); err != nil {
		return ReindexResult{}, false, err
	}
	doc.UpdatedAt = time.Now()
	if err := s.repo.SaveDocument(doc, buildSourceKey(ImportRequest{
		KBType:     doc.KBType,
		SourceType: doc.SourceType,
		SourceRef:  doc.SourceRef,
		Lang:       doc.Lang,
	}), 0); err != nil {
		return ReindexResult{}, false, err
	}

	result := ReindexResult{
		DocumentUID: documentUID,
		ChunkCount:  len(chunks),
		UpdatedAt:   doc.UpdatedAt,
	}
	s.writeAudit(map[string]any{
		"event_type":   "knowledge_document_reindexed",
		"document_uid": documentUID,
		"chunk_count":  len(chunks),
		"updated_at":   doc.UpdatedAt.Format(time.RFC3339Nano),
	})

	return result, true, nil
}

func (s *Service) writeAudit(event map[string]any) {
	if s.auditWriter != nil {
		_ = s.auditWriter.Write(event)
	}
}

func normalizeRequest(req ImportRequest) ImportRequest {
	req.KBType = strings.TrimSpace(req.KBType)
	req.Title = strings.TrimSpace(req.Title)
	req.SourceType = strings.TrimSpace(req.SourceType)
	req.SourceRef = strings.TrimSpace(req.SourceRef)
	req.Lang = strings.TrimSpace(req.Lang)
	req.Content = strings.TrimSpace(req.Content)
	if req.Lang == "" {
		req.Lang = "zh-CN"
	}
	if req.KBType == "" {
		req.KBType = "principle"
	}
	if req.SourceType == "" {
		req.SourceType = "manual"
	}
	return req
}

func buildSourceKey(req ImportRequest) string {
	if req.SourceRef == "" {
		return ""
	}
	return strings.Join([]string{req.KBType, req.SourceType, req.SourceRef, req.Lang}, "|")
}

func hashContent(content string) uint64 {
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(content))
	return hasher.Sum64()
}

func splitContent(documentUID string, content string, chunkSize int) []Chunk {
	text := strings.TrimSpace(content)
	if text == "" {
		return []Chunk{}
	}

	runes := []rune(text)
	chunks := make([]Chunk, 0)
	for i := 0; i < len(runes); i += chunkSize {
		end := i + chunkSize
		if end > len(runes) {
			end = len(runes)
		}
		part := strings.TrimSpace(string(runes[i:end]))
		if part == "" {
			continue
		}
		chunks = append(chunks, Chunk{
			ChunkUID:     idgen.New("chk"),
			DocumentUID:  documentUID,
			ChunkIndex:   len(chunks),
			Content:      part,
			TokenCount:   countTokens(part),
			QdrantPoint:  "",
			QdrantStatus: "pending",
		})
	}

	return chunks
}

func countTokens(content string) int {
	if content == "" {
		return 0
	}
	return len(strings.Fields(content))
}
