package memory

import (
	"sort"
	"sync"

	domainknowledge "lceda_ai/server/internal/domain/knowledge"
)

type KnowledgeRepository struct {
	mu               sync.RWMutex
	documents        map[string]domainknowledge.Document
	chunksByDoc      map[string][]domainknowledge.Chunk
	indexBySourceKey map[string]string
	contentHashByDoc map[string]uint64
}

func NewKnowledgeRepository() *KnowledgeRepository {
	return &KnowledgeRepository{
		documents:        make(map[string]domainknowledge.Document),
		chunksByDoc:      make(map[string][]domainknowledge.Chunk),
		indexBySourceKey: make(map[string]string),
		contentHashByDoc: make(map[string]uint64),
	}
}

func (r *KnowledgeRepository) FindDocumentBySourceKey(sourceKey string) (domainknowledge.Document, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	documentUID, ok := r.indexBySourceKey[sourceKey]
	if !ok {
		return domainknowledge.Document{}, false
	}
	document, ok := r.documents[documentUID]
	return document, ok
}

func (r *KnowledgeRepository) FindContentHash(documentUID string) (uint64, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	value, ok := r.contentHashByDoc[documentUID]
	return value, ok
}

func (r *KnowledgeRepository) SaveDocument(document domainknowledge.Document, sourceKey string, contentHash uint64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.documents[document.DocumentUID] = document
	if sourceKey != "" {
		r.indexBySourceKey[sourceKey] = document.DocumentUID
	}
	if contentHash != 0 {
		r.contentHashByDoc[document.DocumentUID] = contentHash
	}
	return nil
}

func (r *KnowledgeRepository) FindDocument(documentUID string) (domainknowledge.Document, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	document, ok := r.documents[documentUID]
	return document, ok
}

func (r *KnowledgeRepository) ListDocuments(limit int) []domainknowledge.Document {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]domainknowledge.Document, 0, len(r.documents))
	for _, doc := range r.documents {
		out = append(out, doc)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	if limit <= 0 || limit > len(out) {
		limit = len(out)
	}
	copied := make([]domainknowledge.Document, limit)
	copy(copied, out[:limit])
	return copied
}

func (r *KnowledgeRepository) SaveChunks(documentUID string, chunks []domainknowledge.Chunk) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	copied := make([]domainknowledge.Chunk, len(chunks))
	copy(copied, chunks)
	r.chunksByDoc[documentUID] = copied
	return nil
}

func (r *KnowledgeRepository) ListChunks(documentUID string) []domainknowledge.Chunk {
	r.mu.RLock()
	defer r.mu.RUnlock()
	chunks := r.chunksByDoc[documentUID]
	out := make([]domainknowledge.Chunk, len(chunks))
	copy(out, chunks)
	return out
}
