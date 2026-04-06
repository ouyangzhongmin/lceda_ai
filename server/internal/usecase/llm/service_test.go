package llm

import (
	"testing"

	domainllm "lceda_ai/server/internal/domain/llm"
	"lceda_ai/server/internal/repository/memory"
)

type spyAuditWriter struct {
	events []map[string]any
}

func (s *spyAuditWriter) Write(event map[string]any) error {
	s.events = append(s.events, event)
	return nil
}

type fakeProvider struct{}

func (p *fakeProvider) Name() string {
	return "fake"
}

func (p *fakeProvider) Generate(req domainllm.GenerateRequest) (domainllm.CompletionResult, error) {
	return domainllm.CompletionResult{
		Model:            req.Model,
		OutputText:       "ok",
		PromptTokens:     10,
		CompletionTokens: 20,
	}, nil
}

func (p *fakeProvider) StreamGenerate(
	req domainllm.GenerateRequest,
	onDelta func(text string),
	_ func(text string),
) (domainllm.CompletionResult, error) {
	if onDelta != nil {
		onDelta("o")
		onDelta("k")
	}
	return p.Generate(req)
}

func TestGenerateWritesAudit(t *testing.T) {
	writer := &spyAuditWriter{}
	service := NewService(&fakeProvider{}, memory.NewLLMLogRepository(), writer)

	_, err := service.Generate(GenerateRequest{
		UserID:      "usr_1",
		Scene:       "schematic_analysis",
		BillingMode: "credits",
		Model:       "demo",
		Messages: []Message{
			{Role: "user", Content: "hello"},
		},
	})
	if err != nil {
		t.Fatalf("Generate returned error: %v", err)
	}

	if len(writer.events) != 1 {
		t.Fatalf("expected 1 audit event, got %d", len(writer.events))
	}
	if got := writer.events[0]["event_type"]; got != "llm_request_log" {
		t.Fatalf("unexpected event_type: %v", got)
	}
}
