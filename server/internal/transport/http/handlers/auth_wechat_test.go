package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"lceda_ai/server/internal/integration/wechat"
	"lceda_ai/server/internal/repository/memory"
	authusecase "lceda_ai/server/internal/usecase/auth"
)

func TestWechatCallbackInvalidStateReturns401004(t *testing.T) {
	handler := NewAuthHandler(authusecase.NewService(memory.NewAuthRepository(), wechat.NewMockClient()), "http://127.0.0.1:18088")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/wechat/callback?state=bad_state&code=abc", nil)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	handler.WechatCallback(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", rec.Code)
	}
	if rec.Body.String() == "" {
		t.Fatal("expected json body")
	}
	if !strings.Contains(rec.Body.String(), `"code":401004`) {
		t.Fatalf("expected code 401004, got body %s", rec.Body.String())
	}
}

func TestWechatCallbackRedirectsToLoginPageWhenAcceptHTML(t *testing.T) {
	repo := memory.NewAuthRepository()
	service := authusecase.NewService(repo, wechat.NewMockClient())
	handler := NewAuthHandler(service, "http://127.0.0.1:18088")

	session, err := service.CreateLoginSession("http://127.0.0.1:18088")
	if err != nil {
		t.Fatalf("create login session: %v", err)
	}
	authorizeURL, state, err := service.BuildWechatAuthorizeURL(session.LoginSessionID)
	if err != nil || authorizeURL == "" || state == "" {
		t.Fatalf("expected wechat authorize url, got err=%v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/wechat/callback?state="+state+"&code=demo", nil)
	req.Header.Set("Accept", "text/html")
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = req
	handler.WechatCallback(c)

	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d", rec.Code)
	}
	location := rec.Header().Get("Location")
	if !strings.Contains(location, "/login?session=") {
		t.Fatalf("expected redirect to login page, got %s", location)
	}
	if !strings.Contains(location, "poll_token=") {
		t.Fatalf("expected poll_token in redirect, got %s", location)
	}
}
