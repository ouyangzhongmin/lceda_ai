package handlers

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
)

type KnowledgeHandler struct {
	service knowledgeService
}

func NewKnowledgeHandler(service knowledgeService) *KnowledgeHandler {
	return &KnowledgeHandler{service: service}
}

func (h *KnowledgeHandler) ImportDocument(c *gin.Context) {
	var req knowledgeusecase.ImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		ginInvalidBody(c)
		return
	}
	result, err := h.service.Import(req)
	if err != nil {
		ginInternalError(c, err)
		return
	}
	ginSuccess(c, map[string]any{
		"document":    result.Document,
		"chunks":      result.Chunks,
		"import_mode": result.Mode,
	})
}

func (h *KnowledgeHandler) ListDocuments(c *gin.Context) {
	limit := 20
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	documents, err := h.service.ListDocuments(limit)
	if err != nil {
		ginInternalError(c, err)
		return
	}
	ginSuccess(c, map[string]any{"documents": documents})
}

func (h *KnowledgeHandler) ReindexDocument(c *gin.Context) {
	result, ok, err := h.service.Reindex(c.Param("id"))
	if err != nil {
		ginInternalError(c, err)
		return
	}
	if !ok {
		ginNotFound(c, "document not found")
		return
	}
	ginSuccess(c, result)
}
