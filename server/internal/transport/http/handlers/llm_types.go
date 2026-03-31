package handlers

import llmusecase "lceda_ai/server/internal/usecase/llm"

type llmGenerateRequest struct {
	Scene       string               `json:"scene"`
	BillingMode string               `json:"billing_mode"`
	Provider    string               `json:"provider"`
	Model       string               `json:"model"`
	Messages    []llmusecase.Message `json:"messages"`
}
