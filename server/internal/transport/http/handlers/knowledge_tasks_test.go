package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"lceda_ai/server/internal/repository/memory"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
)

func TestKnowledgeImportTaskFlow(t *testing.T) {
	knowledgeService := knowledgeusecase.NewService(memory.NewKnowledgeRepository())
	taskHandler := NewKnowledgeTaskHandler(knowledgeusecase.NewImportTaskService(knowledgeService))

	createBody := map[string]any{
		"kb_type":     "principle",
		"source_type": "manual",
		"source_ref":  "doc-task-1",
		"lang":        "zh-CN",
		"title":       "Task Doc",
		"content":     "task content",
	}
	rawCreateBody, _ := json.Marshal(createBody)
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/knowledge/import-tasks", bytes.NewReader(rawCreateBody))
	createRec := httptest.NewRecorder()
	createCtx, _ := gin.CreateTestContext(createRec)
	createCtx.Request = createReq
	taskHandler.CreateTask(createCtx)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", createRec.Code, createRec.Body.String())
	}

	var createResp struct {
		Code int `json:"code"`
		Data struct {
			TaskUID string `json:"task_uid"`
			Status  string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}
	if createResp.Code != 0 || createResp.Data.TaskUID == "" || createResp.Data.Status != "queued" {
		t.Fatalf("unexpected create response: %s", createRec.Body.String())
	}

	runReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/knowledge/import-tasks/"+createResp.Data.TaskUID+":run",
		nil,
	)
	runRec := httptest.NewRecorder()
	runCtx, _ := gin.CreateTestContext(runRec)
	runCtx.Request = runReq
	runCtx.Params = gin.Params{{Key: "id", Value: createResp.Data.TaskUID}}
	taskHandler.RunTask(runCtx)
	if runRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", runRec.Code, runRec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/knowledge/import-tasks/"+createResp.Data.TaskUID, nil)
	getRec := httptest.NewRecorder()
	getCtx, _ := gin.CreateTestContext(getRec)
	getCtx.Request = getReq
	getCtx.Params = gin.Params{{Key: "id", Value: createResp.Data.TaskUID}}
	taskHandler.GetTask(getCtx)
	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", getRec.Code, getRec.Body.String())
	}

	enqueueReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/knowledge/import-tasks/"+createResp.Data.TaskUID+":enqueue",
		nil,
	)
	enqueueRec := httptest.NewRecorder()
	enqueueCtx, _ := gin.CreateTestContext(enqueueRec)
	enqueueCtx.Request = enqueueReq
	enqueueCtx.Params = gin.Params{{Key: "id", Value: createResp.Data.TaskUID}}
	taskHandler.EnqueueTask(enqueueCtx)
	if enqueueRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", enqueueRec.Code, enqueueRec.Body.String())
	}

	retryReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/knowledge/import-tasks/"+createResp.Data.TaskUID+":retry",
		nil,
	)
	retryRec := httptest.NewRecorder()
	retryCtx, _ := gin.CreateTestContext(retryRec)
	retryCtx.Request = retryReq
	retryCtx.Params = gin.Params{{Key: "id", Value: createResp.Data.TaskUID}}
	taskHandler.RetryTask(retryCtx)
	if retryRec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for non-dead-letter retry, got %d body=%s", retryRec.Code, retryRec.Body.String())
	}
}

func TestKnowledgeImportTaskRetryDeadLetterFlow(t *testing.T) {
	knowledgeService := knowledgeusecase.NewService(memory.NewKnowledgeRepository())
	taskService := knowledgeusecase.NewImportTaskService(knowledgeService)
	taskService.SetTaskRetryPolicy(1, 10*time.Millisecond)
	taskHandler := NewKnowledgeTaskHandler(taskService)

	createBody := map[string]any{
		"title": "Invalid Task For Retry",
	}
	rawCreateBody, _ := json.Marshal(createBody)
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/knowledge/import-tasks", bytes.NewReader(rawCreateBody))
	createRec := httptest.NewRecorder()
	createCtx, _ := gin.CreateTestContext(createRec)
	createCtx.Request = createReq
	taskHandler.CreateTask(createCtx)
	if createRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", createRec.Code, createRec.Body.String())
	}
	var createResp struct {
		Data struct {
			TaskUID string `json:"task_uid"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}
	runReq := httptest.NewRequest(http.MethodPost, "/api/v1/knowledge/import-tasks/"+createResp.Data.TaskUID+":run", nil)
	runRec := httptest.NewRecorder()
	runCtx, _ := gin.CreateTestContext(runRec)
	runCtx.Request = runReq
	runCtx.Params = gin.Params{{Key: "id", Value: createResp.Data.TaskUID}}
	taskHandler.RunTask(runCtx)
	if runRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", runRec.Code, runRec.Body.String())
	}

	retryReq := httptest.NewRequest(http.MethodPost, "/api/v1/knowledge/import-tasks/"+createResp.Data.TaskUID+":retry", nil)
	retryRec := httptest.NewRecorder()
	retryCtx, _ := gin.CreateTestContext(retryRec)
	retryCtx.Request = retryReq
	retryCtx.Params = gin.Params{{Key: "id", Value: createResp.Data.TaskUID}}
	taskHandler.RetryTask(retryCtx)
	if retryRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for dead-letter retry, got %d body=%s", retryRec.Code, retryRec.Body.String())
	}
}

func TestKnowledgeImportTaskStatsAndDeadLettersEndpoints(t *testing.T) {
	knowledgeService := knowledgeusecase.NewService(memory.NewKnowledgeRepository())
	taskService := knowledgeusecase.NewImportTaskService(knowledgeService)
	if _, err := taskService.CreateTask(knowledgeusecase.ImportTaskRequest{
		Title: "Invalid Task For Dead Letter",
	}); err != nil {
		t.Fatalf("create task: %v", err)
	}
	_, _, _ = taskService.RunTask("kbt_not_exist")
	taskHandler := NewKnowledgeTaskHandler(taskService)

	statsReq := httptest.NewRequest(http.MethodGet, "/api/v1/knowledge/import-tasks/stats", nil)
	statsRec := httptest.NewRecorder()
	statsCtx, _ := gin.CreateTestContext(statsRec)
	statsCtx.Request = statsReq
	taskHandler.GetStats(statsCtx)
	if statsRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", statsRec.Code, statsRec.Body.String())
	}

	deadLettersReq := httptest.NewRequest(http.MethodGet, "/api/v1/knowledge/import-tasks/dead-letters?limit=10", nil)
	deadLettersRec := httptest.NewRecorder()
	deadLettersCtx, _ := gin.CreateTestContext(deadLettersRec)
	deadLettersCtx.Request = deadLettersReq
	taskHandler.GetDeadLetters(deadLettersCtx)
	if deadLettersRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", deadLettersRec.Code, deadLettersRec.Body.String())
	}
}
