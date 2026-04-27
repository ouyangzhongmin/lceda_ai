package handlers

import (
	"log"
	"strings"

	"github.com/gin-gonic/gin"
)

type RagHandler struct {
	service ragService
}

type ragExternalTemplateCorpusProvider interface {
	ExternalRagTemplateCorpus(query string, topK int) any
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
	log.Printf("[rag/search] query=%q top_k=%d result_cnt=%d", req.Query, req.TopK, len(results))
	for i, r := range results {
		log.Printf(
			"[rag/search] hit#%d score=%.4f kb_type=%s title=%q source_ref=%q snippet=%q",
			i+1,
			r.Score,
			r.KBType,
			r.Title,
			r.SourceRef,
			trimForLog(r.Snippet, 220),
		)
	}
	data := map[string]any{"results": results}
	if provider, ok := h.service.(ragExternalTemplateCorpusProvider); ok {
		if corpus := provider.ExternalRagTemplateCorpus(req.Query, req.TopK); corpus != nil {
			data["external_rag_template_corpus"] = corpus
		}
	}
	ginSuccess(c, data)
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

func (h *RagHandler) Providers(c *gin.Context) {
	ginSuccess(c, map[string]any{
		"provider": h.service.ProviderName(),
	})
}

func trimForLog(text string, maxLen int) string {
	cleaned := strings.TrimSpace(strings.ReplaceAll(text, "\n", " "))
	if maxLen <= 0 || len(cleaned) <= maxLen {
		return cleaned
	}
	return cleaned[:maxLen] + "..."
}
