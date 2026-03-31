package knowledge

import "time"

type Document struct {
	DocumentUID string    `json:"document_uid"`
	KBType      string    `json:"kb_type"`
	Title       string    `json:"title"`
	SourceType  string    `json:"source_type"`
	SourceRef   string    `json:"source_ref"`
	Lang        string    `json:"lang"`
	Status      string    `json:"status"`
	ChunkCount  int       `json:"chunk_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Chunk struct {
	ChunkUID     string `json:"chunk_uid"`
	DocumentUID  string `json:"document_uid"`
	ChunkIndex   int    `json:"chunk_index"`
	Content      string `json:"content"`
	TokenCount   int    `json:"token_count"`
	QdrantPoint  string `json:"qdrant_point_id"`
	QdrantStatus string `json:"qdrant_status"`
}

type ImportRequest struct {
	KBType     string `json:"kb_type"`
	Title      string `json:"title"`
	SourceType string `json:"source_type"`
	SourceRef  string `json:"source_ref"`
	Lang       string `json:"lang"`
	Content    string `json:"content"`
}

type ReindexResult struct {
	DocumentUID string    `json:"document_uid"`
	ChunkCount  int       `json:"chunk_count"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type ImportMode string

const (
	ImportModeCreated          ImportMode = "created"
	ImportModeUpdated          ImportMode = "updated"
	ImportModeSkippedDuplicate ImportMode = "skipped_duplicate"
)

type ImportResult struct {
	Document Document
	Chunks   []Chunk
	Mode     ImportMode
}

type Repository interface {
	FindDocumentBySourceKey(sourceKey string) (Document, bool)
	FindContentHash(documentUID string) (uint64, bool)
	SaveDocument(document Document, sourceKey string, contentHash uint64) error
	FindDocument(documentUID string) (Document, bool)
	ListDocuments(limit int) []Document
	SaveChunks(documentUID string, chunks []Chunk) error
	ListChunks(documentUID string) []Chunk
}
