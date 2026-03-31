package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"lceda_ai/server/internal/integration/wechat"
	"lceda_ai/server/internal/repository/memory"
	authusecase "lceda_ai/server/internal/usecase/auth"
)

func TestGetLoginSessionWaitSecondsReturnsWhenStatusChanges(t *testing.T) {
	repo := memory.NewAuthRepository()
	service := authusecase.NewService(repo, wechat.NewMockClient())
	handler := NewAuthHandler(service, "http://127.0.0.1:18082")

	session, err := service.CreateLoginSession("http://127.0.0.1:18082")
	if err != nil {
		t.Fatalf("create login session: %v", err)
	}
	go func() {
		time.Sleep(200 * time.Millisecond)
		current, ok := repo.FindLoginSession(session.LoginSessionID)
		if !ok {
			return
		}
		current.Status = "success"
		current.ExchangeToken = "et_demo"
		_ = repo.SaveLoginSession(current)
	}()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login-sessions/"+session.LoginSessionID+"?poll_token="+session.PollToken+"&wait_seconds=2", nil)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	c.Params = gin.Params{{Key: "id", Value: session.LoginSessionID}}
	handler.GetLoginSession(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Code int `json:"code"`
		Data struct {
			Status        string `json:"status"`
			ExchangeToken string `json:"exchange_token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Code != 0 {
		t.Fatalf("expected code 0, got %d", resp.Code)
	}
	if resp.Data.Status != "success" || resp.Data.ExchangeToken == "" {
		t.Fatalf("unexpected status response: %+v", resp.Data)
	}
}
