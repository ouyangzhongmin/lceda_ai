package rag

type SearchQuery struct {
	Collection string
	QueryText  string
	TopK       int
}

type SearchResult struct {
	ChunkID   string  `json:"chunk_id"`
	Score     float64 `json:"score"`
	Title     string  `json:"title"`
	Snippet   string  `json:"snippet"`
	SourceRef string  `json:"source_ref"`
	KBType    string  `json:"kb_type"`
	Metadata  any     `json:"metadata,omitempty"`
}

type CitationPackage struct {
	Query         string         `json:"query"`
	Results       []SearchResult `json:"results"`
	CitationLines []string       `json:"citation_lines"`
}

type Retriever interface {
	Search(query SearchQuery) ([]SearchResult, error)
}
