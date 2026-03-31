package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"lceda_ai/server/internal/repository/memory"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
)

func TestKnowledgeImportListReindex(t *testing.T) {
	service := knowledgeusecase.NewService(memory.NewKnowledgeRepository())
	handler := NewKnowledgeHandler(service)

	importBody := map[string]any{
		"kb_type":     "principle",
		"source_type": "manual",
		"source_ref":  "doc-ldo-v1",
		"lang":        "zh-CN",
		"title":       "LDO Guide",
		"content":     "LDO input and output capacitor design notes.",
	}
	rawImportBody, _ := json.Marshal(importBody)
	importReq := httptest.NewRequest(http.MethodPost, "/api/v1/knowledge/documents", bytes.NewReader(rawImportBody))
	importRec := httptest.NewRecorder()
	importCtx, _ := gin.CreateTestContext(importRec)
	importCtx.Request = importReq
	handler.ImportDocument(importCtx)
	if importRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", importRec.Code)
	}

	var importResp struct {
		Code int `json:"code"`
		Data struct {
			ImportMode string `json:"import_mode"`
			Document   struct {
				DocumentUID string `json:"document_uid"`
			} `json:"document"`
		} `json:"data"`
	}
	if err := json.Unmarshal(importRec.Body.Bytes(), &importResp); err != nil {
		t.Fatalf("unmarshal import response: %v", err)
	}
	if importResp.Code != 0 || importResp.Data.Document.DocumentUID == "" {
		t.Fatalf("unexpected import response: %s", importRec.Body.String())
	}
	if importResp.Data.ImportMode != "created" {
		t.Fatalf("expected import_mode created, got %s", importResp.Data.ImportMode)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/knowledge/documents?limit=10", nil)
	listRec := httptest.NewRecorder()
	listCtx, _ := gin.CreateTestContext(listRec)
	listCtx.Request = listReq
	handler.ListDocuments(listCtx)
	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", listRec.Code)
	}

	reindexReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/knowledge/documents/"+importResp.Data.Document.DocumentUID+":reindex",
		nil,
	)
	reindexRec := httptest.NewRecorder()
	reindexCtx, _ := gin.CreateTestContext(reindexRec)
	reindexCtx.Request = reindexReq
	reindexCtx.Params = gin.Params{{Key: "id", Value: importResp.Data.Document.DocumentUID}}
	handler.ReindexDocument(reindexCtx)
	if reindexRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", reindexRec.Code, reindexRec.Body.String())
	}

	updateBody := map[string]any{
		"kb_type":     "principle",
		"source_type": "manual",
		"source_ref":  "doc-ldo-v1",
		"lang":        "zh-CN",
		"title":       "LDO Guide v2",
		"content":     "second version",
	}
	rawUpdateBody, _ := json.Marshal(updateBody)
	updateReq := httptest.NewRequest(http.MethodPost, "/api/v1/knowledge/documents", bytes.NewReader(rawUpdateBody))
	updateRec := httptest.NewRecorder()
	updateCtx, _ := gin.CreateTestContext(updateRec)
	updateCtx.Request = updateReq
	handler.ImportDocument(updateCtx)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", updateRec.Code)
	}
	var updateResp struct {
		Code int `json:"code"`
		Data struct {
			ImportMode string `json:"import_mode"`
		} `json:"data"`
	}
	if err := json.Unmarshal(updateRec.Body.Bytes(), &updateResp); err != nil {
		t.Fatalf("unmarshal update response: %v", err)
	}
	if updateResp.Data.ImportMode != "updated" {
		t.Fatalf("expected updated mode, got %s", updateResp.Data.ImportMode)
	}

	dupReq := httptest.NewRequest(http.MethodPost, "/api/v1/knowledge/documents", bytes.NewReader(rawUpdateBody))
	dupRec := httptest.NewRecorder()
	dupCtx, _ := gin.CreateTestContext(dupRec)
	dupCtx.Request = dupReq
	handler.ImportDocument(dupCtx)
	if dupRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", dupRec.Code)
	}
	var dupResp struct {
		Code int `json:"code"`
		Data struct {
			ImportMode string `json:"import_mode"`
		} `json:"data"`
	}
	if err := json.Unmarshal(dupRec.Body.Bytes(), &dupResp); err != nil {
		t.Fatalf("unmarshal duplicate response: %v", err)
	}
	if dupResp.Data.ImportMode != "skipped_duplicate" {
		t.Fatalf("expected skipped_duplicate mode, got %s", dupResp.Data.ImportMode)
	}
}
