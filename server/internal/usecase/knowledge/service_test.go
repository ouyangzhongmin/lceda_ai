package knowledge

import (
	"strings"
	"testing"

	"lceda_ai/server/internal/repository/memory"
)

type spyAuditWriter struct {
	events []map[string]any
}

func (s *spyAuditWriter) Write(event map[string]any) error {
	s.events = append(s.events, event)
	return nil
}

func TestImportListReindex(t *testing.T) {
	writer := &spyAuditWriter{}
	service := NewService(memory.NewKnowledgeRepository(), writer)

	content := strings.Repeat("A", 650)
	imported, err := service.Import(ImportRequest{
		Title:   "LDO 设计",
		Content: content,
	})
	if err != nil {
		t.Fatalf("import document: %v", err)
	}
	doc := imported.Document
	chunks := imported.Chunks
	if imported.Mode != ImportModeCreated {
		t.Fatalf("expected created mode, got %s", imported.Mode)
	}
	if doc.DocumentUID == "" {
		t.Fatal("expected document uid")
	}
	if doc.ChunkCount != len(chunks) {
		t.Fatalf("expected chunk_count %d, got %d", len(chunks), doc.ChunkCount)
	}
	if len(chunks) < 2 {
		t.Fatalf("expected content split into at least 2 chunks, got %d", len(chunks))
	}
	if len(writer.events) != 1 || writer.events[0]["event_type"] != "knowledge_document_imported" {
		t.Fatalf("expected imported audit event, got %+v", writer.events)
	}

	docs, err := service.ListDocuments(10)
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	if len(docs) != 1 {
		t.Fatalf("expected one document, got %d", len(docs))
	}
	if docs[0].DocumentUID != doc.DocumentUID {
		t.Fatalf("unexpected document uid: %s", docs[0].DocumentUID)
	}

	result, ok, err := service.Reindex(doc.DocumentUID)
	if err != nil {
		t.Fatalf("reindex document: %v", err)
	}
	if !ok {
		t.Fatal("expected reindex success")
	}
	if result.ChunkCount != len(chunks) {
		t.Fatalf("expected chunk_count %d, got %d", len(chunks), result.ChunkCount)
	}
	if len(writer.events) != 2 || writer.events[1]["event_type"] != "knowledge_document_reindexed" {
		t.Fatalf("expected reindexed audit event, got %+v", writer.events)
	}

	_, missing, err := service.Reindex("doc_missing")
	if err != nil {
		t.Fatalf("reindex missing document: %v", err)
	}
	if missing {
		t.Fatal("expected missing document reindex to return false")
	}
}

func TestImportUpsertAndDeduplicate(t *testing.T) {
	writer := &spyAuditWriter{}
	service := NewService(memory.NewKnowledgeRepository(), writer)

	first, err := service.Import(ImportRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-ldo-v1",
		Lang:       "zh-CN",
		Title:      "LDO 指南",
		Content:    "first version",
	})
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	if first.Mode != ImportModeCreated {
		t.Fatalf("expected created mode, got %s", first.Mode)
	}

	updated, err := service.Import(ImportRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-ldo-v1",
		Lang:       "zh-CN",
		Title:      "LDO 指南 v2",
		Content:    "second version",
	})
	if err != nil {
		t.Fatalf("update import: %v", err)
	}
	if updated.Mode != ImportModeUpdated {
		t.Fatalf("expected updated mode, got %s", updated.Mode)
	}
	if updated.Document.DocumentUID != first.Document.DocumentUID {
		t.Fatalf("expected same document uid, got %s and %s", first.Document.DocumentUID, updated.Document.DocumentUID)
	}
	if updated.Document.Title != "LDO 指南 v2" {
		t.Fatalf("expected title updated, got %s", updated.Document.Title)
	}

	duplicate, err := service.Import(ImportRequest{
		KBType:     "principle",
		SourceType: "manual",
		SourceRef:  "doc-ldo-v1",
		Lang:       "zh-CN",
		Title:      "LDO 指南 v2",
		Content:    "second version",
	})
	if err != nil {
		t.Fatalf("duplicate import: %v", err)
	}
	if duplicate.Mode != ImportModeSkippedDuplicate {
		t.Fatalf("expected skipped duplicate mode, got %s", duplicate.Mode)
	}

	docs, err := service.ListDocuments(10)
	if err != nil {
		t.Fatalf("list documents: %v", err)
	}
	if len(docs) != 1 {
		t.Fatalf("expected one document, got %d", len(docs))
	}

	if len(writer.events) != 3 {
		t.Fatalf("expected 3 audit events, got %d", len(writer.events))
	}
	if writer.events[0]["event_type"] != "knowledge_document_imported" {
		t.Fatalf("unexpected first event: %v", writer.events[0]["event_type"])
	}
	if writer.events[1]["event_type"] != "knowledge_document_updated" {
		t.Fatalf("unexpected second event: %v", writer.events[1]["event_type"])
	}
	if writer.events[2]["event_type"] != "knowledge_document_import_skipped_duplicate" {
		t.Fatalf("unexpected third event: %v", writer.events[2]["event_type"])
	}
}
