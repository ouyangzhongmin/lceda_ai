package llm

import "time"

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type GenerateRequest struct {
	UserID      string
	Scene       string
	BillingMode string
	Provider    string
	Model       string
	Messages    []Message
}

type CompletionResult struct {
	RequestID        string `json:"request_id"`
	Model            string `json:"model"`
	OutputText       string `json:"output_text"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	CostCredits      int64  `json:"cost_credits"`
}

type RequestLog struct {
	RequestID       string    `json:"request_id"`
	UserID          string    `json:"user_id"`
	Scene           string    `json:"scene"`
	BillingMode     string    `json:"billing_mode"`
	Provider        string    `json:"provider"`
	Model           string    `json:"model"`
	RequestTokens   int       `json:"request_tokens"`
	ResponseTokens  int       `json:"response_tokens"`
	TotalTokens     int       `json:"total_tokens"`
	LatencyMs       int       `json:"latency_ms"`
	Status          string    `json:"status"`
	ErrorCode       string    `json:"error_code,omitempty"`
	CostCredits     int64     `json:"cost_credits"`
	ResponseSummary string    `json:"response_summary"`
	CreatedAt       time.Time `json:"created_at"`
}

type Provider interface {
	Generate(req GenerateRequest) (CompletionResult, error)
	StreamGenerate(req GenerateRequest, onDelta func(text string)) (CompletionResult, error)
	Name() string
}

type ProviderInfo struct {
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	Enabled      bool     `json:"enabled"`
	DefaultModel string   `json:"default_model"`
	Models       []string `json:"models"`
}

type LogRepository interface {
	SaveLog(log RequestLog) error
	ListLogs(userID string, limit int) []RequestLog
}
