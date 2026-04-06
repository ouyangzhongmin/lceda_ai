package handlers

import llmusecase "lceda_ai/server/internal/usecase/llm"

type llmTool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string      `json:"name"`
		Description string      `json:"description,omitempty"`
		Parameters  interface{} `json:"parameters,omitempty"`
	} `json:"function"`
}

type llmGenerateRequest struct {
	Scene       string               `json:"scene"`
	BillingMode string               `json:"billing_mode"`
	Provider    string               `json:"provider"`
	Model       string               `json:"model"`
	Messages    []llmusecase.Message `json:"messages"`
	Tools       []llmTool            `json:"tools,omitempty"`
	ToolChoice  interface{}          `json:"tool_choice,omitempty"`
}
