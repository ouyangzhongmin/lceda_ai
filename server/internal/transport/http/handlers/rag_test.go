package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	ragusecase "lceda_ai/server/internal/usecase/rag"
)

type stubRagService struct {
	results []ragusecase.SearchResult
}

func (s stubRagService) Search(query string, topK int) ([]ragusecase.SearchResult, error) {
	return s.results, nil
}

func (s stubRagService) BuildCitationPackage(query string, topK int) (ragusecase.CitationPackage, error) {
	return ragusecase.CitationPackage{
		Query:   query,
		Results: s.results,
	}, nil
}

func (s stubRagService) ProviderName() string {
	return "stub"
}

func (s stubRagService) ExternalRagTemplateCorpus(query string, topK int) any {
	return nil
}

type stubRagServiceWithCorpus struct {
	stubRagService
	corpus []map[string]any
}

func (s stubRagServiceWithCorpus) ExternalRagTemplateCorpus(query string, topK int) any {
	return s.corpus
}

func TestRagSearchReturnsResultsOnlyWhenNoExternalCorpusAvailable(t *testing.T) {
	handler := NewRagHandler(stubRagService{
		results: []ragusecase.SearchResult{
			{
				ChunkID:   "chk-1",
				Score:     0.98,
				Title:     "ESP32-S3 Power",
				Snippet:   "Use 10uF and 100nF decoupling.",
				SourceRef: "doc-esp32s3-v1",
				KBType:    "principle",
			},
		},
	})

	body := []byte(`{"query":"esp32s3 电源","top_k":3}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rag/search", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = req

	handler.Search(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Code int `json:"code"`
		Data struct {
			Results                   []ragusecase.SearchResult `json:"results"`
			ExternalRagTemplateCorpus json.RawMessage           `json:"external_rag_template_corpus"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Code != 0 {
		t.Fatalf("unexpected code: %d", resp.Code)
	}
	if len(resp.Data.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(resp.Data.Results))
	}
	if string(resp.Data.ExternalRagTemplateCorpus) != "" {
		t.Fatalf("expected empty external corpus field, got %s", string(resp.Data.ExternalRagTemplateCorpus))
	}
}

func TestRagSearchIncludesExternalCorpusWhenServiceProvidesIt(t *testing.T) {
	handler := NewRagHandler(stubRagServiceWithCorpus{
		stubRagService: stubRagService{
			results: []ragusecase.SearchResult{
				{
					ChunkID:   "chk-2",
					Score:     0.99,
					Title:     "ESP32-S3 Devboard",
					Snippet:   "USB input and LDO reference.",
					SourceRef: "kb://esp32s3-devboard",
					KBType:    "open_source",
				},
			},
		},
		corpus: []map[string]any{
			{
				"template_id":           "external-esp32s3-usb-input",
				"template_type":         "usb_power_input",
				"anchor_device_family":  "ESP32",
				"anchor_device_model":   "ESP32-S3",
				"scenario_tags":         []string{"devboard", "usb"},
				"quality_score":         0.96,
				"components":            []map[string]any{{"ref": "J1", "name": "usb_c", "completion_role": "usb_input"}},
				"pin_bindings":          []map[string]any{},
				"default_values":        []map[string]any{},
				"source":                map[string]any{"kind": "lceda_open_source_extract", "project_id": "oshw-1", "sheet_ref": "sheet-1", "extraction_revision": "r1"},
			},
		},
	})

	body := []byte(`{"query":"esp32s3 开发板","top_k":3}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rag/search", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = req

	handler.Search(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Code int `json:"code"`
		Data struct {
			Results                   []ragusecase.SearchResult `json:"results"`
			ExternalRagTemplateCorpus []map[string]any          `json:"external_rag_template_corpus"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.Data.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(resp.Data.Results))
	}
	if len(resp.Data.ExternalRagTemplateCorpus) != 1 {
		t.Fatalf("expected 1 corpus entry, got %d body=%s", len(resp.Data.ExternalRagTemplateCorpus), rec.Body.String())
	}
	if got := resp.Data.ExternalRagTemplateCorpus[0]["template_id"]; got != "external-esp32s3-usb-input" {
		t.Fatalf("unexpected template_id: %v", got)
	}
}
