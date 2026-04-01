package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	authusecase "lceda_ai/server/internal/usecase/auth"
)

type AuthHandler struct {
	service authService
	baseURL string
}

func NewAuthHandler(service authService, baseURL string) *AuthHandler {
	return &AuthHandler{
		service: service,
		baseURL: baseURL,
	}
}

func (h *AuthHandler) CreateLoginSession(c *gin.Context) {
	session, err := h.service.CreateLoginSession(h.baseURL)
	if err != nil {
		ginInternalError(c, err)
		return
	}
	ginSuccess(c, map[string]any{
		"login_session_id": session.LoginSessionID,
		"poll_token":       session.PollToken,
		"login_url":        session.LoginURL,
		"expires_at":       session.ExpiresAt.Format(timeFormat),
		"interval_seconds": 2,
	})
}

func (h *AuthHandler) GetLoginSession(c *gin.Context) {
	waitSeconds := 0
	if raw := strings.TrimSpace(c.Query("wait_seconds")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			waitSeconds = parsed
		}
	}
	session, err := h.service.GetLoginSessionWithWait(c.Param("id"), c.Query("poll_token"), waitSeconds)
	if err != nil {
		ginError(c, http.StatusBadRequest, 401002, err.Error())
		return
	}
	data := map[string]any{
		"login_session_id": session.LoginSessionID,
		"status":           session.Status,
		"expires_at":       session.ExpiresAt.Format(timeFormat),
	}
	if session.ExchangeToken != "" {
		data["exchange_token"] = session.ExchangeToken
	}
	ginSuccess(c, data)
}

func (h *AuthHandler) SendEmailCode(c *gin.Context) {
	var req sendEmailCodeRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	if err := h.service.SendEmailCode(req.LoginSessionID, req.Email); err != nil {
		ginBadRequest(c, err.Error())
		return
	}
	ginSuccess(c, map[string]any{
		"sent": true,
		"hint": "verification code sent",
	})
}

func (h *AuthHandler) VerifyEmailCode(c *gin.Context) {
	var req verifyEmailCodeRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	session, err := h.service.VerifyEmailCode(req.LoginSessionID, req.Email, req.Code)
	if err != nil {
		ginError(c, http.StatusBadRequest, 401003, err.Error())
		return
	}
	ginSuccess(c, map[string]any{
		"login_session_id": session.LoginSessionID,
		"status":           session.Status,
		"exchange_token":   session.ExchangeToken,
	})
}

func (h *AuthHandler) TokenAction(c *gin.Context) {
	action := strings.TrimSpace(c.Query("action"))
	if action == "" {
		var req tokenActionRequest
		if err := c.ShouldBindJSON(&req); err == nil {
			action = req.Action
		}
	}
	switch action {
	case "tokens:exchange":
		h.ExchangeToken(c)
	case "tokens:refresh":
		h.RefreshToken(c)
	default:
		ginNotFound(c, "resource not found")
	}
}

func (h *AuthHandler) ExchangeToken(c *gin.Context) {
	var req exchangeTokenRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	user, token, err := h.service.ExchangeToken(req.LoginSessionID, req.ExchangeToken)
	if err != nil {
		writeAuthFlowError(c, err, 401001, authusecase.ErrInvalidExchange, authusecase.ErrSessionNotFound, authusecase.ErrSessionNotReady)
		return
	}
	ginSuccess(c, map[string]any{
		"access_token":       token.AccessToken,
		"refresh_token":      token.RefreshToken,
		"expires_in":         token.ExpiresIn,
		"refresh_expires_in": token.RefreshExpiresIn,
		"user":               user,
	})
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req refreshTokenRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	user, token, err := h.service.RefreshToken(req.RefreshToken)
	if err != nil {
		writeAuthFlowError(c, err, 401001, authusecase.ErrRefreshTokenFailed)
		return
	}
	ginSuccess(c, map[string]any{
		"access_token":       token.AccessToken,
		"refresh_token":      token.RefreshToken,
		"expires_in":         token.ExpiresIn,
		"refresh_expires_in": token.RefreshExpiresIn,
		"user":               user,
	})
}

func (h *AuthHandler) GetCurrentUser(c *gin.Context) {
	user, ok := h.currentUser(c)
	if !ok {
		return
	}
	ginSuccess(c, map[string]any{
		"user_id":        user.UserID,
		"display_name":   user.DisplayName,
		"email":          user.Email,
		"email_verified": user.EmailVerified,
		"wechat_bound":   user.WechatBound,
		"user_type":      user.UserType,
		"created_at":     user.CreatedAt.Format(timeFormat),
	})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	accessToken, ok := currentAccessToken(c)
	if !ok {
		return
	}
	var req logoutRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	if err := h.service.Logout(accessToken, req.AllDevices); err != nil {
		writeUnauthorizedOrInternal(c, err, authusecase.ErrAccessTokenFailed)
		return
	}
	ginSuccess(c, map[string]any{
		"logged_out":  true,
		"all_devices": req.AllDevices,
	})
}
