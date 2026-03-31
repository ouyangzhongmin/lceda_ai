package handlers

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
)

type KnowledgeTaskHandler struct {
	service knowledgeTaskService
}

func NewKnowledgeTaskHandler(service knowledgeTaskService) *KnowledgeTaskHandler {
	return &KnowledgeTaskHandler{service: service}
}

func (h *KnowledgeTaskHandler) CreateTask(c *gin.Context) {
	var req knowledgeusecase.ImportTaskRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	task, err := h.service.CreateTask(req)
	if err != nil {
		ginInternalError(c, err)
		return
	}
	ginSuccess(c, task)
}

func (h *KnowledgeTaskHandler) GetTask(c *gin.Context) {
	task, ok, err := h.service.GetTask(c.Param("id"))
	if err != nil {
		ginInternalError(c, err)
		return
	}
	if !ok {
		ginNotFound(c, "task not found")
		return
	}
	ginSuccess(c, task)
}

func (h *KnowledgeTaskHandler) RunTask(c *gin.Context) {
	h.runTaskAction(c, ":run")
}

func (h *KnowledgeTaskHandler) EnqueueTask(c *gin.Context) {
	h.runTaskAction(c, ":enqueue")
}

func (h *KnowledgeTaskHandler) RetryTask(c *gin.Context) {
	h.runTaskAction(c, ":retry")
}

func (h *KnowledgeTaskHandler) GetStats(c *gin.Context) {
	ginSuccess(c, h.service.Stats())
}

func (h *KnowledgeTaskHandler) GetDeadLetters(c *gin.Context) {
	limit := 20
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	ginSuccess(c, map[string]any{
		"items": h.service.ListDeadLetters(limit),
	})
}

func (h *KnowledgeTaskHandler) runTaskAction(c *gin.Context, action string) {
	taskUID := strings.TrimSpace(c.Param("id"))
	if taskUID == "" {
		ginBadRequest(c, "invalid task id")
		return
	}
	var (
		task knowledgeusecase.ImportTask
		ok   bool
		err  error
	)
	task, ok, err = h.executeTaskAction(taskUID, action)
	if err != nil && action == ":retry" {
		writeRetryTaskError(c, err)
		return
	}
	if err != nil {
		ginInternalError(c, err)
		return
	}
	if !ok {
		ginNotFound(c, "task not found")
		return
	}
	ginSuccess(c, task)
}
