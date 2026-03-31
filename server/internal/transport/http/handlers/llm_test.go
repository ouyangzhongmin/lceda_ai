package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"lceda_ai/server/internal/integration/llmproviders"
	"lceda_ai/server/internal/integration/wechat"
	"lceda_ai/server/internal/repository/memory"
	authusecase "lceda_ai/server/internal/usecase/auth"
	creditsusecase "lceda_ai/server/internal/usecase/credits"
	llmusecase "lceda_ai/server/internal/usecase/llm"
)

func TestLLMGenerateRequiresMessages(t *testing.T) {
	authRepo := memory.NewAuthRepository()
	authSvc := authusecase.NewService(authRepo, wechat.NewMockClient())
	creditsSvc := creditsusecase.NewService(memory.NewCreditsRepository())
	llmSvc := llmusecase.NewService(llmproviders.NewDemoProvider(), memory.NewLLMLogRepository())
	handler := NewLLMHandler(authSvc, creditsSvc, llmSvc)

	session, err := authSvc.CreateLoginSession("http://127.0.0.1:18082")
	if err != nil {
		t.Fatalf("create login session: %v", err)
	}
	if err := authSvc.SendEmailCode(session.LoginSessionID, "demo@example.com"); err != nil {
		t.Fatalf("send email code: %v", err)
	}
	code, ok := authRepo.FindEmailCode(session.LoginSessionID)
	if !ok {
		t.Fatal("expected stored email code")
	}
	verified, err := authSvc.VerifyEmailCode(session.LoginSessionID, "demo@example.com", code)
	if err != nil {
		t.Fatalf("verify email code: %v", err)
	}
	_, tokenPair, err := authSvc.ExchangeToken(session.LoginSessionID, verified.ExchangeToken)
	if err != nil {
		t.Fatalf("exchange token: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/llm/generate", bytes.NewBufferString(`{"scene":"schematic_analysis","billing_mode":"credits","model":"demo-llm","messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+tokenPair.AccessToken)
	req.Header.Set("content-type", "application/json")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	handler.Generate(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}
