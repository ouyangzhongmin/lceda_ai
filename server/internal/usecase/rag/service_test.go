package rag

import (
	"testing"

	domainrag "lceda_ai/server/internal/domain/rag"
)

type spyAuditWriter struct {
	events []map[string]any
}

func (s *spyAuditWriter) Write(event map[string]any) error {
	s.events = append(s.events, event)
	return nil
}

type fixedVectorStore struct{}

func (f *fixedVectorStore) Search(_ domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	return []domainrag.SearchResult{
		{
			ChunkID:   "chk_test_001",
			Score:     0.99,
			Title:     "Test Citation",
			Snippet:   "snippet",
			SourceRef: "src#1",
			KBType:    "principle",
		},
	}, nil
}

func TestBuildCitationPackageWritesAudit(t *testing.T) {
	writer := &spyAuditWriter{}
	service := NewService("test_collection", &fixedVectorStore{}, writer)

	pack, err := service.BuildCitationPackage("ldo", 3)
	if err != nil {
		t.Fatalf("BuildCitationPackage returned error: %v", err)
	}
	if pack.Query != "ldo" {
		t.Fatalf("unexpected query: %s", pack.Query)
	}
	if len(writer.events) != 1 {
		t.Fatalf("expected 1 audit event, got %d", len(writer.events))
	}

	if got := writer.events[0]["event_type"]; got != "rag_citation_package" {
		t.Fatalf("unexpected event_type: %v", got)
	}
}
