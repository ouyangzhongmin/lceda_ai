package handlers

import (
	"encoding/json"
	"log"
	"strconv"

	"github.com/gin-gonic/gin"
	llmusecase "lceda_ai/server/internal/usecase/llm"
)

type LLMHandler struct {
	authService    authService
	creditsService creditsService
	service        llmService
}

func NewLLMHandler(authService authService, creditsService creditsService, service llmService) *LLMHandler {
	return &LLMHandler{
		authService:    authService,
		creditsService: creditsService,
		service:        service,
	}
}

func (h *LLMHandler) Generate(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	var req llmGenerateRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	if len(req.Messages) == 0 {
		ginBadRequest(c, "messages is required")
		return
	}
	log.Printf("[LCEDA-AI][server][llm] request.start user_id=%s scene=%s billing_mode=%s provider=%s model=%s message_count=%d",
		user.UserID, req.Scene, req.BillingMode, req.Provider, req.Model, len(req.Messages))
	result, providerErr := h.service.Generate(llmusecase.GenerateRequest{
		UserID:      user.UserID,
		Scene:       req.Scene,
		BillingMode: req.BillingMode,
		Provider:    req.Provider,
		Model:       req.Model,
		Messages:    req.Messages,
		Tools:       req.Tools,
		ToolChoice:  req.ToolChoice,
	})
	if providerErr != nil {
		log.Printf("[LCEDA-AI][server][llm] request.failed user_id=%s provider=%s model=%s error=%v", user.UserID, req.Provider, req.Model, providerErr)
		ginBadGateway(c, providerErr)
		return
	}
	tx, err := h.creditsService.Consume(user.UserID, result.CostCredits, req.Scene, "llm_request", result.RequestID, "llm.generate consumption")
	if err != nil {
		log.Printf("[LCEDA-AI][server][llm] credits.failed user_id=%s request_id=%s cost_credits=%d error=%v",
			user.UserID, result.RequestID, result.CostCredits, err)
		writeCreditsConsumeError(c, err)
		return
	}
	log.Printf("[LCEDA-AI][server][llm] request.success user_id=%s request_id=%s model=%s prompt_tokens=%d completion_tokens=%d cost_credits=%d remaining_credits=%d",
		user.UserID, result.RequestID, result.Model, result.PromptTokens, result.CompletionTokens, result.CostCredits, tx.BalanceAfter)
	ginSuccess(c, map[string]any{
		"request_id":          result.RequestID,
		"model":               result.Model,
		"output_text":         result.OutputText,
		"tool_calls":          result.ToolCalls,
		"prompt_tokens":       result.PromptTokens,
		"completion_tokens":   result.CompletionTokens,
		"cost_credits":        result.CostCredits,
		"remaining_credits":   tx.BalanceAfter,
		"billing_transaction": tx.TransactionID,
	})
}

func (h *LLMHandler) GenerateStream(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	var req llmGenerateRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	if len(req.Messages) == 0 {
		ginBadRequest(c, "messages is required")
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	streamEvent(c, "start", map[string]any{
		"type":  "start",
		"model": req.Model,
	})

	result, providerErr := h.service.StreamGenerate(llmusecase.GenerateRequest{
		UserID:      user.UserID,
		Scene:       req.Scene,
		BillingMode: req.BillingMode,
		Provider:    req.Provider,
		Model:       req.Model,
		Messages:    req.Messages,
		Tools:       req.Tools,
		ToolChoice:  req.ToolChoice,
	}, func(text string) {
		streamEvent(c, "delta", map[string]any{
			"type":  "delta",
			"delta": text,
		})
	}, func(text string) {
		streamEvent(c, "reasoning_delta", map[string]any{
			"type":            "reasoning_delta",
			"reasoning_delta": text,
		})
	})
	if providerErr != nil {
		streamEvent(c, "error", map[string]any{
			"type":  "error",
			"error": providerErr.Error(),
		})
		return
	}
	tx, err := h.creditsService.Consume(user.UserID, result.CostCredits, req.Scene, "llm_request", result.RequestID, "llm.generate consumption")
	if err != nil {
		streamEvent(c, "error", map[string]any{
			"type":  "error",
			"error": err.Error(),
		})
		return
	}
	streamEvent(c, "done", map[string]any{
		"type":                "done",
		"request_id":          result.RequestID,
		"model":               result.Model,
		"output_text":         result.OutputText,
		"tool_calls":          result.ToolCalls,
		"prompt_tokens":       result.PromptTokens,
		"completion_tokens":   result.CompletionTokens,
		"cost_credits":        result.CostCredits,
		"remaining_credits":   tx.BalanceAfter,
		"billing_transaction": tx.TransactionID,
	})
}

func (h *LLMHandler) ListLogs(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	limit := 20
	if raw := c.Query("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	ginSuccess(c, map[string]any{
		"logs": h.service.ListLogs(user.UserID, limit),
	})
}

func (h *LLMHandler) ListProviders(c *gin.Context) {
	if _, ok := h.currentUser(c); !ok {
		return
	}
	ginSuccess(c, map[string]any{
		"providers": h.service.ListProviders(),
	})
}

func streamEvent(c *gin.Context, event string, payload map[string]any) {
	bytes, _ := json.Marshal(payload)
	_, _ = c.Writer.WriteString("event: " + event + "\n")
	_, _ = c.Writer.WriteString("data: " + string(bytes) + "\n\n")
	c.Writer.Flush()
}
