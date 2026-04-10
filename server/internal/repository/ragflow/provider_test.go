package ragflow

import (
    "net/http"
    "net/http/httptest"
    "testing"

    qdrantrepo "lceda_ai/server/internal/repository/qdrant"
)

func TestProviderSearchMapsFields(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        _, _ = w.Write([]byte(`{
          "data": {
            "results": [
              {
                "id": "chk_1",
                "score": 0.91,
                "title": "LDO Guide",
                "content": "LDO input capacitor near VIN",
                "metadata": {
                  "source_ref": "doc-ldo-v1#p12",
                  "kb_type": "principle"
                }
              }
            ]
          }
        }`))
    }))
    defer srv.Close()

    p := NewProvider(ProviderConfig{
        BaseURL:          srv.URL,
        APIKey:           "k",
        DatasetID:        "ds_1",
        TimeoutSeconds:   5,
        EndpointTemplate: "/api/v1/datasets/{dataset_id}/search",
    })

    hits, err := p.Search(qdrantrepo.SearchQuery{QueryText: "ldo", TopK: 5})
    if err != nil {
        t.Fatalf("search error: %v", err)
    }
    if len(hits) != 1 {
        t.Fatalf("expected 1 hit, got %d", len(hits))
    }
    if hits[0].ChunkID != "chk_1" {
        t.Fatalf("unexpected chunk id: %s", hits[0].ChunkID)
    }
    if hits[0].KBType != "principle" {
        t.Fatalf("unexpected kb_type: %s", hits[0].KBType)
    }
}
