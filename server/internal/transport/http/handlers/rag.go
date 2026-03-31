package handlers

import (
	"github.com/gin-gonic/gin"
)

type RagHandler struct {
	service ragService
}

func NewRagHandler(service ragService) *RagHandler {
	return &RagHandler{service: service}
}

func (h *RagHandler) Search(c *gin.Context) {
	var req struct {
		Query string `json:"query"`
		TopK  int    `json:"top_k"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginInvalidBody(c)
		return
	}
	results, err := h.service.Search(req.Query, req.TopK)
	if err != nil {
		ginBadGateway(c, err)
		return
	}
	ginSuccess(c, map[string]any{"results": results})
}

func (h *RagHandler) BuildCitations(c *gin.Context) {
	var req struct {
		Query string `json:"query"`
		TopK  int    `json:"top_k"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginInvalidBody(c)
		return
	}
	pack, err := h.service.BuildCitationPackage(req.Query, req.TopK)
	if err != nil {
		ginBadGateway(c, err)
		return
	}
	ginSuccess(c, pack)
}
