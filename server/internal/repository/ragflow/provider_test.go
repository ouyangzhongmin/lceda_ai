package ragflow

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	qdrantrepo "lceda_ai/server/internal/repository/qdrant"
)

func TestProviderSearchMapsFields(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/retrieval" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if got := body["question"]; got != "ldo" {
			t.Fatalf("unexpected question: %#v", got)
		}
		ids, ok := body["dataset_ids"].([]any)
		if !ok || len(ids) != 1 || ids[0] != "ds_1" {
			t.Fatalf("unexpected dataset_ids: %#v", body["dataset_ids"])
		}
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
		EndpointTemplate: "/api/v1/retrieval",
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

func TestProviderSearchExposesExternalRagTemplateCorpus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/retrieval" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
          "data": {
            "results": [
              {
                "id": "chk_1",
                "score": 0.91,
                "title": "ESP32-S3 Board",
                "content": "USB-C + LDO + decoupling",
                "metadata": {
                  "source_ref": "oshw#1",
                  "kb_type": "open_source"
                }
              }
            ],
            "external_rag_template_corpus": [
              {
                "template_id": "external-esp32s3-power",
                "template_type": "mcu_power_core",
                "anchor_device_family": "ESP32",
                "anchor_device_model": "ESP32-S3",
                "scenario_tags": ["devboard", "power"],
                "components": [
                  {
                    "ref": "C1",
                    "name": "capacitor",
                    "completion_role": "mcu_bulk_decoupling",
                    "value": "10uF",
                    "attach_to_net": "3V3"
                  }
                ],
                "pin_bindings": [],
                "default_values": [],
                "source": {
                  "kind": "lceda_open_source_extract",
                  "project_id": "oshw-esp32s3",
                  "sheet_ref": "sheet-1",
                  "extraction_revision": "r1"
                },
                "quality_score": 0.97
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
		EndpointTemplate: "/api/v1/retrieval",
	})

	_, err := p.Search(qdrantrepo.SearchQuery{QueryText: "esp32s3", TopK: 5})
	if err != nil {
		t.Fatalf("search error: %v", err)
	}
	corpus := p.ExternalRagTemplateCorpus()
	if len(corpus) != 1 {
		t.Fatalf("expected 1 corpus entry, got %d", len(corpus))
	}
	if got := corpus[0]["template_id"]; got != "external-esp32s3-power" {
		t.Fatalf("unexpected template id: %v", got)
	}
}

func TestProviderSearchMapsChunksResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/retrieval" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
		  "data": {
		    "chunks": [
		      {
		        "id": "chunk_1",
		        "document_keyword": "tpl-esp32-s3-gpio_passive_power_chain-80cf943d.md",
		        "content": "P1: EN -> R47 -> 3V3",
		        "similarity": 0.88
		      },
		      {
		        "id": "chunk_2",
		        "document_keyword": "",
		        "content": "P1: GPIO0 -> R46 -> 3V3",
		        "similarity": 0.81
		      }
		    ],
		    "doc_aggs": [
		      { "doc_name": "doc-unused.md" },
		      { "doc_name": "project_combo_local-files-022.md" }
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
		EndpointTemplate: "/api/v1/retrieval",
	})

	hits, err := p.Search(qdrantrepo.SearchQuery{QueryText: "esp32-s3", TopK: 5})
	if err != nil {
		t.Fatalf("search error: %v", err)
	}
	if len(hits) != 2 {
		t.Fatalf("expected 2 hits, got %d", len(hits))
	}
	if hits[0].Title != "tpl-esp32-s3-gpio_passive_power_chain-80cf943d.md" {
		t.Fatalf("unexpected first title: %q", hits[0].Title)
	}
	if hits[1].Title != "project_combo_local-files-022.md" {
		t.Fatalf("unexpected second title: %q", hits[1].Title)
	}
	if hits[0].Score != 0.88 {
		t.Fatalf("unexpected first score: %v", hits[0].Score)
	}
}

func TestProviderSearchExtractsChunkMetadataFromMarkdownFooter(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/retrieval" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		payload := "{\n" +
			"  \"data\": {\n" +
			"    \"chunks\": [\n" +
			"      {\n" +
			"        \"id\": \"chunk_1\",\n" +
			"        \"document_keyword\": \"training.ti.com-designing-low-emi-power-converters-for-industrial-and-automotive-systems-video-ti-com-bc363f2e96.md\",\n" +
			"        \"content\": \"# Designing low EMI\\nUseful EMI guidance.\\n\\n---\\nmetadata:\\n```json\\n{\\\"kb_type\\\":\\\"principle\\\",\\\"source_type\\\":\\\"official_doc\\\",\\\"source_ref\\\":\\\"training.ti.com-designing-low-emi-power-converters-for-industrial-and-automotive-systems-video-ti-com-bc363f2e96\\\",\\\"lang\\\":\\\"zh-CN\\\"}\\n```\",\n" +
			"        \"similarity\": 0.68\n" +
			"      }\n" +
			"    ],\n" +
			"    \"doc_aggs\": [\n" +
			"      { \"doc_name\": \"training.ti.com-designing-low-emi-power-converters-for-industrial-and-automotive-systems-video-ti-com-bc363f2e96.md\" }\n" +
			"    ]\n" +
			"  }\n" +
			"}"
		_, _ = w.Write([]byte(payload))
	}))
	defer srv.Close()

	p := NewProvider(ProviderConfig{
		BaseURL:          srv.URL,
		APIKey:           "k",
		DatasetID:        "ds_1",
		TimeoutSeconds:   5,
		EndpointTemplate: "/api/v1/retrieval",
	})

	hits, err := p.Search(qdrantrepo.SearchQuery{QueryText: "EMI", TopK: 5})
	if err != nil {
		t.Fatalf("search error: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit, got %d", len(hits))
	}
	if hits[0].SourceRef != "training.ti.com-designing-low-emi-power-converters-for-industrial-and-automotive-systems-video-ti-com-bc363f2e96" {
		t.Fatalf("unexpected source_ref: %q", hits[0].SourceRef)
	}
	if hits[0].KBType != "principle" {
		t.Fatalf("unexpected kb_type: %q", hits[0].KBType)
	}
}

func TestProviderSearchBackfillsChunkMetadataFromSameDocument(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/retrieval" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		payload := "{\n" +
			"  \"data\": {\n" +
			"    \"chunks\": [\n" +
			"      {\n" +
			"        \"id\": \"chunk_1\",\n" +
			"        \"document_id\": \"doc_emi_1\",\n" +
			"        \"document_keyword\": \"www.ti.com-snva489c-pdf-c53bd72bcd.md\",\n" +
			"        \"content\": \"Useful EMI guidance.\\n\\n---\\nmetadata:\\n```json\\n{\\\"kb_type\\\":\\\"principle\\\",\\\"source_ref\\\":\\\"www.ti.com-snva489c-pdf-c53bd72bcd\\\"}\\n```\",\n" +
			"        \"similarity\": 0.68\n" +
			"      },\n" +
			"      {\n" +
			"        \"id\": \"chunk_2\",\n" +
			"        \"document_id\": \"doc_emi_1\",\n" +
			"        \"document_keyword\": \"www.ti.com-snva489c-pdf-c53bd72bcd.md\",\n" +
			"        \"content\": \"Another section without footer metadata.\",\n" +
			"        \"similarity\": 0.67\n" +
			"      }\n" +
			"    ],\n" +
			"    \"doc_aggs\": [\n" +
			"      { \"doc_name\": \"www.ti.com-snva489c-pdf-c53bd72bcd.md\" },\n" +
			"      { \"doc_name\": \"www.ti.com-snva489c-pdf-c53bd72bcd.md\" }\n" +
			"    ]\n" +
			"  }\n" +
			"}"
		_, _ = w.Write([]byte(payload))
	}))
	defer srv.Close()

	p := NewProvider(ProviderConfig{
		BaseURL:          srv.URL,
		APIKey:           "k",
		DatasetID:        "ds_1",
		TimeoutSeconds:   5,
		EndpointTemplate: "/api/v1/retrieval",
	})

	hits, err := p.Search(qdrantrepo.SearchQuery{QueryText: "EMI", TopK: 5})
	if err != nil {
		t.Fatalf("search error: %v", err)
	}
	if len(hits) != 2 {
		t.Fatalf("expected 2 hits, got %d", len(hits))
	}
	if hits[1].SourceRef != "www.ti.com-snva489c-pdf-c53bd72bcd" {
		t.Fatalf("unexpected backfilled source_ref: %q", hits[1].SourceRef)
	}
	if hits[1].KBType != "principle" {
		t.Fatalf("unexpected backfilled kb_type: %q", hits[1].KBType)
	}
}

func TestProviderSearchInfersChunkMetadataFromDocumentTitle(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/retrieval" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		payload := "{\n" +
			"  \"data\": {\n" +
			"    \"chunks\": [\n" +
			"      {\n" +
			"        \"id\": \"chunk_1\",\n" +
			"        \"document_id\": \"doc_emi_2\",\n" +
			"        \"document_keyword\": \"www.ti.com-snva489c-pdf-c53bd72bcd.md\",\n" +
			"        \"content\": \"Useful EMI guidance without footer metadata.\",\n" +
			"        \"similarity\": 0.68\n" +
			"      }\n" +
			"    ],\n" +
			"    \"doc_aggs\": [\n" +
			"      { \"doc_name\": \"www.ti.com-snva489c-pdf-c53bd72bcd.md\" }\n" +
			"    ]\n" +
			"  }\n" +
			"}"
		_, _ = w.Write([]byte(payload))
	}))
	defer srv.Close()

	p := NewProvider(ProviderConfig{
		BaseURL:          srv.URL,
		APIKey:           "k",
		DatasetID:        "ds_1",
		TimeoutSeconds:   5,
		EndpointTemplate: "/api/v1/retrieval",
	})

	hits, err := p.Search(qdrantrepo.SearchQuery{QueryText: "EMI", TopK: 5})
	if err != nil {
		t.Fatalf("search error: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("expected 1 hit, got %d", len(hits))
	}
	if hits[0].SourceRef != "www.ti.com-snva489c-pdf-c53bd72bcd" {
		t.Fatalf("unexpected inferred source_ref: %q", hits[0].SourceRef)
	}
	if hits[0].KBType != "principle" {
		t.Fatalf("unexpected inferred kb_type: %q", hits[0].KBType)
	}
}
