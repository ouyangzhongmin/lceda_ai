package auth

import (
	"strings"
	"testing"
	"time"

	"lceda_ai/server/internal/integration/wechat"
	"lceda_ai/server/internal/repository/memory"
)

func TestGetLoginSessionWithWaitReturnsAfterStatusChanged(t *testing.T) {
	repo := memory.NewAuthRepository()
	service := NewService(repo, wechat.NewMockClient())
	session, err := service.CreateLoginSession("http://127.0.0.1:18082")
	if err != nil {
		t.Fatalf("create login session: %v", err)
	}

	go func() {
		time.Sleep(250 * time.Millisecond)
		current, ok := repo.FindLoginSession(session.LoginSessionID)
		if !ok {
			return
		}
		current.Status = "success"
		_ = repo.SaveLoginSession(current)
	}()

	started := time.Now()
	result, err := service.GetLoginSessionWithWait(session.LoginSessionID, session.PollToken, 2)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	elapsed := time.Since(started)
	if result.Status != "success" {
		t.Fatalf("expected success, got %s", result.Status)
	}
	if elapsed < 200*time.Millisecond {
		t.Fatalf("expected wait behavior, elapsed too short: %v", elapsed)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("expected return before wait timeout, elapsed too long: %v", elapsed)
	}
}

func TestGetLoginSessionWithWaitCapsToTwentySeconds(t *testing.T) {
	repo := memory.NewAuthRepository()
	service := NewService(repo, wechat.NewMockClient())
	session, err := service.CreateLoginSession("http://127.0.0.1:18082")
	if err != nil {
		t.Fatalf("create login session: %v", err)
	}

	started := time.Now()
	_, err = service.GetLoginSessionWithWait(session.LoginSessionID, session.PollToken, -1)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	elapsed := time.Since(started)
	if elapsed > 300*time.Millisecond {
		t.Fatalf("expected no wait for negative wait_seconds, got elapsed %v", elapsed)
	}
}

func TestCreateLoginSessionLoginURLContainsPollToken(t *testing.T) {
	repo := memory.NewAuthRepository()
	service := NewService(repo, wechat.NewMockClient())
	session, err := service.CreateLoginSession("http://127.0.0.1:18082")
	if err != nil {
		t.Fatalf("create login session: %v", err)
	}
	if session.LoginURL == "" {
		t.Fatal("expected login url")
	}
	if !strings.Contains(session.LoginURL, "poll_token=") {
		t.Fatalf("expected login url include poll_token, got %s", session.LoginURL)
	}
}
