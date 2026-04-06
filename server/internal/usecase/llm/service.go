package llm

import (
	"errors"
	"log"
	"time"

	domainllm "lceda_ai/server/internal/domain/llm"
	"lceda_ai/server/internal/pkg/idgen"
)

type Message = domainllm.Message
type GenerateRequest = domainllm.GenerateRequest
type CompletionResult = domainllm.CompletionResult
type RequestLog = domainllm.RequestLog
type ProviderInfo = domainllm.ProviderInfo

type Service struct {
	repo        domainllm.LogRepository
	provider    domainllm.Provider
	providers   map[string]domainllm.Provider
	providerIDs []domainllm.ProviderInfo
	defaultID   string
	auditWriter AuditWriter
}

type AuditWriter interface {
	Write(event map[string]any) error
}

func NewService(provider domainllm.Provider, repo domainllm.LogRepository, auditWriter ...AuditWriter) *Service {
	var writer AuditWriter
	if len(auditWriter) > 0 {
		writer = auditWriter[0]
	}
	defaultID := provider.Name()
	return &Service{
		repo:        repo,
		provider:    provider,
		providers:   map[string]domainllm.Provider{defaultID: provider},
		providerIDs: []domainllm.ProviderInfo{{ID: defaultID, Label: defaultID, Enabled: true, DefaultModel: "", Models: nil}},
		defaultID:   defaultID,
		auditWriter: writer,
	}
}

func NewServiceWithProviders(
	defaultID string,
	providers map[string]domainllm.Provider,
	providerInfos []domainllm.ProviderInfo,
	repo domainllm.LogRepository,
	auditWriter ...AuditWriter,
) *Service {
	var writer AuditWriter
	if len(auditWriter) > 0 {
		writer = auditWriter[0]
	}
	defaultProvider, ok := providers[defaultID]
	if !ok {
		defaultProvider = domainllm.Provider(nil)
	}
	return &Service{
		repo:        repo,
		provider:    defaultProvider,
		providers:   providers,
		providerIDs: providerInfos,
		defaultID:   defaultID,
		auditWriter: writer,
	}
}

func (s *Service) Generate(req GenerateRequest) (CompletionResult, error) {
	model := req.Model
	scene := req.Scene
	if scene == "" {
		scene = "general"
	}

	billingMode := req.BillingMode
	if billingMode == "" {
		billingMode = "credits"
	}

	requestID := idgen.New("llm")
	selectedProvider, providerID, err := s.resolveProvider(req.Provider)
	if err != nil {
		log.Printf("[LCEDA-AI][server][llm] generate.provider_missing request_id=%s user_id=%s provider=%s error=%v",
			requestID, req.UserID, req.Provider, err)
		return CompletionResult{}, err
	}
	log.Printf("[LCEDA-AI][server][llm] generate.begin request_id=%s user_id=%s provider=%s scene=%s billing_mode=%s model=%s message_count=%d",
		requestID, req.UserID, providerID, scene, billingMode, model, len(req.Messages))
	startedAt := time.Now()
	providerResponse, err := selectedProvider.Generate(domainllm.GenerateRequest{
		UserID:      req.UserID,
		Scene:       scene,
		BillingMode: billingMode,
		Provider:    providerID,
		Model:       model,
		Messages:    req.Messages,
		Tools:       req.Tools,
		ToolChoice:  req.ToolChoice,
	})
	latency := time.Since(startedAt)

	status := "success"
	errorCode := ""
	outputText := providerResponse.OutputText
	promptTokens := providerResponse.PromptTokens
	completionTokens := providerResponse.CompletionTokens
	if err != nil {
		status = "failed"
		errorCode = "provider_error"
		outputText = "provider call failed: " + err.Error()
		promptTokens = 0
		completionTokens = 0
		log.Printf("[LCEDA-AI][server][llm] generate.provider_failed request_id=%s provider=%s model=%s latency_ms=%d error=%v",
			requestID, providerID, model, int(latency/time.Millisecond), err)
	} else {
		log.Printf("[LCEDA-AI][server][llm] generate.provider_success request_id=%s provider=%s resolved_model=%s latency_ms=%d prompt_tokens=%d completion_tokens=%d",
			requestID, providerID, firstNonEmpty(providerResponse.Model, model), int(latency/time.Millisecond), promptTokens, completionTokens)
	}

	result := CompletionResult{
		RequestID:        requestID,
		Model:            providerResponse.Model,
		OutputText:       outputText,
		ToolCalls:        providerResponse.ToolCalls,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		CostCredits:      estimateCredits(promptTokens, completionTokens),
	}
	if result.Model == "" {
		result.Model = model
	}
	if err != nil {
		result.CostCredits = 0
	}

	logEntry := RequestLog{
		RequestID:       requestID,
		UserID:          req.UserID,
		Scene:           scene,
		BillingMode:     billingMode,
		Provider:        providerID,
		Model:           result.Model,
		RequestTokens:   result.PromptTokens,
		ResponseTokens:  result.CompletionTokens,
		TotalTokens:     result.PromptTokens + result.CompletionTokens,
		LatencyMs:       int(latency / time.Millisecond),
		Status:          status,
		ErrorCode:       errorCode,
		CostCredits:     result.CostCredits,
		ResponseSummary: result.OutputText,
		CreatedAt:       time.Now(),
	}
	if err := s.repo.SaveLog(logEntry); err != nil {
		log.Printf("[LCEDA-AI][server][llm] log_repo.save_failed request_id=%s error=%v", requestID, err)
	}
	if s.auditWriter != nil {
		if err := s.auditWriter.Write(map[string]any{
			"event_type":       "llm_request_log",
			"request_id":       logEntry.RequestID,
			"user_id":          logEntry.UserID,
			"scene":            logEntry.Scene,
			"billing_mode":     logEntry.BillingMode,
			"provider":         logEntry.Provider,
			"model":            logEntry.Model,
			"request_tokens":   logEntry.RequestTokens,
			"response_tokens":  logEntry.ResponseTokens,
			"total_tokens":     logEntry.TotalTokens,
			"latency_ms":       logEntry.LatencyMs,
			"status":           logEntry.Status,
			"error_code":       logEntry.ErrorCode,
			"cost_credits":     logEntry.CostCredits,
			"response_summary": logEntry.ResponseSummary,
			"created_at":       logEntry.CreatedAt.Format(time.RFC3339Nano),
		}); err != nil {
			log.Printf("[LCEDA-AI][server][llm] audit_writer.write_failed request_id=%s error=%v", requestID, err)
		}
	}

	return result, err
}

func (s *Service) StreamGenerate(
	req GenerateRequest,
	onDelta func(text string),
	onReasoningDelta func(text string),
) (CompletionResult, error) {
	model := req.Model
	scene := req.Scene
	if scene == "" {
		scene = "general"
	}
	billingMode := req.BillingMode
	if billingMode == "" {
		billingMode = "credits"
	}
	requestID := idgen.New("llm")
	selectedProvider, providerID, err := s.resolveProvider(req.Provider)
	if err != nil {
		log.Printf("[LCEDA-AI][server][llm] stream.provider_missing request_id=%s user_id=%s provider=%s error=%v",
			requestID, req.UserID, req.Provider, err)
		return CompletionResult{}, err
	}
	log.Printf("[LCEDA-AI][server][llm] stream.begin request_id=%s user_id=%s provider=%s scene=%s billing_mode=%s model=%s message_count=%d",
		requestID, req.UserID, providerID, scene, billingMode, model, len(req.Messages))
	startedAt := time.Now()
	providerResponse, err := selectedProvider.StreamGenerate(domainllm.GenerateRequest{
		UserID:      req.UserID,
		Scene:       scene,
		BillingMode: billingMode,
		Provider:    providerID,
		Model:       model,
		Messages:    req.Messages,
		Tools:       req.Tools,
		ToolChoice:  req.ToolChoice,
	}, onDelta, onReasoningDelta)
	latency := time.Since(startedAt)

	status := "success"
	errorCode := ""
	outputText := providerResponse.OutputText
	promptTokens := providerResponse.PromptTokens
	completionTokens := providerResponse.CompletionTokens
	if err != nil {
		status = "failed"
		errorCode = "provider_error"
		outputText = "provider call failed: " + err.Error()
		promptTokens = 0
		completionTokens = 0
		log.Printf("[LCEDA-AI][server][llm] stream.provider_failed request_id=%s provider=%s model=%s latency_ms=%d error=%v",
			requestID, providerID, model, int(latency/time.Millisecond), err)
	} else {
		log.Printf("[LCEDA-AI][server][llm] stream.provider_success request_id=%s provider=%s resolved_model=%s latency_ms=%d prompt_tokens=%d completion_tokens=%d",
			requestID, providerID, firstNonEmpty(providerResponse.Model, model), int(latency/time.Millisecond), promptTokens, completionTokens)
	}

	result := CompletionResult{
		RequestID:        requestID,
		Model:            providerResponse.Model,
		OutputText:       outputText,
		ToolCalls:        providerResponse.ToolCalls,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		CostCredits:      estimateCredits(promptTokens, completionTokens),
	}
	if result.Model == "" {
		result.Model = model
	}
	if err != nil {
		result.CostCredits = 0
	}
	logEntry := RequestLog{
		RequestID:       requestID,
		UserID:          req.UserID,
		Scene:           scene,
		BillingMode:     billingMode,
		Provider:        providerID,
		Model:           result.Model,
		RequestTokens:   result.PromptTokens,
		ResponseTokens:  result.CompletionTokens,
		TotalTokens:     result.PromptTokens + result.CompletionTokens,
		LatencyMs:       int(latency / time.Millisecond),
		Status:          status,
		ErrorCode:       errorCode,
		CostCredits:     result.CostCredits,
		ResponseSummary: result.OutputText,
		CreatedAt:       time.Now(),
	}
	if err := s.repo.SaveLog(logEntry); err != nil {
		log.Printf("[LCEDA-AI][server][llm] log_repo.save_failed request_id=%s error=%v", requestID, err)
	}
	if s.auditWriter != nil {
		if err := s.auditWriter.Write(map[string]any{
			"event_type":       "llm_request_log",
			"request_id":       logEntry.RequestID,
			"user_id":          logEntry.UserID,
			"scene":            logEntry.Scene,
			"billing_mode":     logEntry.BillingMode,
			"provider":         logEntry.Provider,
			"model":            logEntry.Model,
			"request_tokens":   logEntry.RequestTokens,
			"response_tokens":  logEntry.ResponseTokens,
			"total_tokens":     logEntry.TotalTokens,
			"latency_ms":       logEntry.LatencyMs,
			"status":           logEntry.Status,
			"error_code":       logEntry.ErrorCode,
			"cost_credits":     logEntry.CostCredits,
			"response_summary": logEntry.ResponseSummary,
			"created_at":       logEntry.CreatedAt.Format(time.RFC3339Nano),
		}); err != nil {
			log.Printf("[LCEDA-AI][server][llm] audit_writer.write_failed request_id=%s error=%v", requestID, err)
		}
	}
	return result, err
}

func (s *Service) ListLogs(userID string, limit int) []RequestLog {
	return s.repo.ListLogs(userID, limit)
}

func (s *Service) ListProviders() []domainllm.ProviderInfo {
	return append([]domainllm.ProviderInfo(nil), s.providerIDs...)
}

func estimateCredits(promptTokens int, completionTokens int) int64 {
	total := promptTokens + completionTokens
	cost := int64(total / 32)
	if total%32 != 0 {
		cost++
	}
	if cost <= 0 {
		return 1
	}
	return cost
}

func firstNonEmpty(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func (s *Service) resolveProvider(providerID string) (domainllm.Provider, string, error) {
	selectedID := providerID
	if selectedID == "" {
		selectedID = s.defaultID
	}
	provider, ok := s.providers[selectedID]
	if !ok || provider == nil {
		return nil, selectedID, errors.New("unknown llm provider: " + selectedID)
	}
	return provider, selectedID, nil
}
