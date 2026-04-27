package qdrant

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	domainrag "lceda_ai/server/internal/domain/rag"
)

type Embedder interface {
	Embed(text string) ([]float64, error)
}

type SearchQuery struct {
	Collection string
	QueryText  string
	TopK       int
}

type SearchHit struct {
	ChunkID   string
	Score     float64
	Title     string
	Snippet   string
	SourceRef string
	KBType    string
}

type VectorStore interface {
	Search(query SearchQuery) ([]SearchHit, error)
}

type ExternalRagTemplateCorpusProvider interface {
	ExternalRagTemplateCorpus() any
}

type RetrieverAdapter struct {
	store VectorStore
}

func NewRetrieverAdapter(store VectorStore) *RetrieverAdapter {
	return &RetrieverAdapter{store: store}
}

func (a *RetrieverAdapter) Search(query domainrag.SearchQuery) ([]domainrag.SearchResult, error) {
	hits, err := a.store.Search(SearchQuery{
		Collection: query.Collection,
		QueryText:  query.QueryText,
		TopK:       query.TopK,
	})
	if err != nil {
		return nil, err
	}

	results := make([]domainrag.SearchResult, 0, len(hits))
	for _, hit := range hits {
		results = append(results, domainrag.SearchResult{
			ChunkID:   hit.ChunkID,
			Score:     hit.Score,
			Title:     hit.Title,
			Snippet:   hit.Snippet,
			SourceRef: hit.SourceRef,
			KBType:    hit.KBType,
		})
	}
	return results, nil
}

func (a *RetrieverAdapter) ExternalRagTemplateCorpus() any {
	if provider, ok := a.store.(ExternalRagTemplateCorpusProvider); ok {
		return provider.ExternalRagTemplateCorpus()
	}
	return nil
}

type QdrantVectorStore struct {
	baseURL    string
	apiKey     string
	collection string
	embedder   Embedder
	httpClient *http.Client
}

func NewQdrantVectorStore(baseURL string, apiKey string, collection string, embedder Embedder) *QdrantVectorStore {
	return &QdrantVectorStore{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     apiKey,
		collection: collection,
		embedder:   embedder,
		httpClient: &http.Client{Timeout: 12 * time.Second},
	}
}

func (s *QdrantVectorStore) Search(query SearchQuery) ([]SearchHit, error) {
	if s == nil || s.embedder == nil {
		return nil, errors.New("qdrant vector store is not initialized")
	}
	if query.TopK <= 0 {
		query.TopK = 3
	}
	collection := query.Collection
	if collection == "" {
		collection = s.collection
	}

	vector, err := s.embedder.Embed(query.QueryText)
	if err != nil {
		return nil, err
	}

	reqPayload := map[string]any{
		"vector":       vector,
		"limit":        query.TopK,
		"with_payload": true,
	}
	body, _ := json.Marshal(reqPayload)
	req, err := http.NewRequest(
		http.MethodPost,
		strings.TrimRight(s.baseURL, "/")+"/collections/"+collection+"/points/search",
		bytes.NewBuffer(body),
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.apiKey != "" {
		req.Header.Set("api-key", s.apiKey)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, errors.New("qdrant search failed: " + resp.Status)
	}

	var decoded struct {
		Result []struct {
			ID      any     `json:"id"`
			Score   float64 `json:"score"`
			Payload struct {
				ChunkID   string `json:"chunk_id"`
				Title     string `json:"title"`
				Snippet   string `json:"snippet"`
				SourceRef string `json:"source_ref"`
				KBType    string `json:"kb_type"`
			} `json:"payload"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}

	results := make([]SearchHit, 0, len(decoded.Result))
	for _, row := range decoded.Result {
		chunkID := row.Payload.ChunkID
		if chunkID == "" {
			chunkID = stringifyID(row.ID)
		}
		results = append(results, SearchHit{
			ChunkID:   chunkID,
			Score:     row.Score,
			Title:     row.Payload.Title,
			Snippet:   row.Payload.Snippet,
			SourceRef: row.Payload.SourceRef,
			KBType:    row.Payload.KBType,
		})
	}

	return results, nil
}

func stringifyID(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return "unknown_id"
	}
}

type InMemoryVectorStore struct{}

func NewInMemoryVectorStore() *InMemoryVectorStore {
	return &InMemoryVectorStore{}
}

func (s *InMemoryVectorStore) Search(query SearchQuery) ([]SearchHit, error) {
	if query.TopK <= 0 {
		query.TopK = 3
	}
	results := []SearchHit{
		{
			ChunkID:   "chk_ldo_001",
			Score:     0.93,
			Title:     "LDO Design Guide",
			Snippet:   "LDO input pin should connect to the upstream supply net and output pin should connect to the regulated rail with proper decoupling.",
			SourceRef: "doc-ldo-v1#p12",
			KBType:    "principle",
		},
		{
			ChunkID:   "chk_diode_002",
			Score:     0.88,
			Title:     "Diode Polarity Notes",
			Snippet:   "For polarity-sensitive diodes, verify anode and cathode orientation against the expected power direction before schematic release.",
			SourceRef: "doc-diode-v2#p4",
			KBType:    "component",
		},
		{
			ChunkID:   "chk_power_003",
			Score:     0.84,
			Title:     "Power Domain Review Checklist",
			Snippet:   "Do not mix pins expecting GND, 3V3, and 5V on the same power net unless the design explicitly requires it.",
			SourceRef: "doc-review-v1#p2",
			KBType:    "rule",
		},
	}
	if query.TopK > len(results) {
		query.TopK = len(results)
	}
	return results[:query.TopK], nil
}

type FallbackVectorStore struct {
	primary  VectorStore
	fallback VectorStore
}

func NewFallbackVectorStore(primary VectorStore, fallback VectorStore) *FallbackVectorStore {
	return &FallbackVectorStore{
		primary:  primary,
		fallback: fallback,
	}
}

func (s *FallbackVectorStore) Search(query SearchQuery) ([]SearchHit, error) {
	if s.primary != nil {
		results, err := s.primary.Search(query)
		if err == nil {
			return results, nil
		}
	}

	if s.fallback != nil {
		return s.fallback.Search(query)
	}

	return nil, errors.New("no available vector store")
}

func (s *FallbackVectorStore) ExternalRagTemplateCorpus() any {
	if provider, ok := s.primary.(ExternalRagTemplateCorpusProvider); ok {
		if corpus := provider.ExternalRagTemplateCorpus(); corpus != nil {
			return corpus
		}
	}
	if provider, ok := s.fallback.(ExternalRagTemplateCorpusProvider); ok {
		return provider.ExternalRagTemplateCorpus()
	}
	return nil
}
