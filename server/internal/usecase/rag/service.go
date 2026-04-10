package rag

import domainrag "lceda_ai/server/internal/domain/rag"

type SearchResult = domainrag.SearchResult
type CitationPackage = domainrag.CitationPackage

type Service struct {
	collection  string
	retriever   domainrag.Retriever
	auditWriter AuditWriter
	provider    string
}

type AuditWriter interface {
	Write(event map[string]any) error
}

func NewService(collection string, retriever domainrag.Retriever, auditWriter ...AuditWriter) *Service {
	var writer AuditWriter
	if len(auditWriter) > 0 {
		writer = auditWriter[0]
	}
	if collection == "" {
		collection = "electronics_principles"
	}
	return &Service{
		collection:  collection,
		retriever:   retriever,
		auditWriter: writer,
		provider:    "unknown",
	}
}

func (s *Service) Search(query string, topK int) ([]SearchResult, error) {
	return s.retriever.Search(domainrag.SearchQuery{
		Collection: s.collection,
		QueryText:  query,
		TopK:       topK,
	})
}

func (s *Service) BuildCitationPackage(query string, topK int) (CitationPackage, error) {
	results, err := s.Search(query, topK)
	if err != nil {
		return CitationPackage{}, err
	}

	pack := CitationPackage{
		Query:         query,
		Results:       results,
		CitationLines: buildCitationLines(results),
	}
	if s.auditWriter != nil {
		_ = s.auditWriter.Write(map[string]any{
			"event_type": "rag_citation_package",
			"query":      query,
			"top_k":      topK,
			"result_cnt": len(results),
			"results":    results,
		})
	}

	return pack, nil
}

func (s *Service) SetProviderName(provider string) {
	if provider == "" {
		provider = "unknown"
	}
	s.provider = provider
}

func (s *Service) ProviderName() string {
	if s.provider == "" {
		return "unknown"
	}
	return s.provider
}

func buildCitationLines(results []SearchResult) []string {
	lines := make([]string, 0, len(results))
	for _, result := range results {
		lines = append(lines, "["+result.Title+"] "+result.SourceRef)
	}
	return lines
}
