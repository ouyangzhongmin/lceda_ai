package handlers

import (
	"log"
	"strconv"

	"github.com/gin-gonic/gin"
)

type CreditsHandler struct {
	authService    authService
	creditsService creditsService
}

func NewCreditsHandler(
	authService authService,
	creditsService creditsService,
) *CreditsHandler {
	return &CreditsHandler{
		authService:    authService,
		creditsService: creditsService,
	}
}

func (h *CreditsHandler) GetBalance(c *gin.Context) {
	accessToken, ok := ginBearerToken(c)
	if !ok {
		log.Printf("[LCEDA-AI][server][auth] access_token.missing method=%s path=%s remote=%s user_agent=%q",
			c.Request.Method, c.Request.URL.Path, c.ClientIP(), c.Request.UserAgent())
		ginMissingAccessToken(c)
		return
	}
	user, err := h.authService.GetUserByAccessToken(accessToken)
	if err != nil {
		log.Printf("[LCEDA-AI][server][auth] access_token.invalid method=%s path=%s remote=%s error=%v",
			c.Request.Method, c.Request.URL.Path, c.ClientIP(), err)
		ginUnauthorized(c, err.Error())
		return
	}
	balance, err := h.creditsService.GetBalance(user.UserID)
	if err != nil {
		ginInternalError(c, err)
		return
	}
	ginSuccess(c, balance)
}

func (h *CreditsHandler) ListTransactions(c *gin.Context) {
	accessToken, ok := ginBearerToken(c)
	if !ok {
		log.Printf("[LCEDA-AI][server][auth] access_token.missing method=%s path=%s remote=%s user_agent=%q",
			c.Request.Method, c.Request.URL.Path, c.ClientIP(), c.Request.UserAgent())
		ginMissingAccessToken(c)
		return
	}
	user, err := h.authService.GetUserByAccessToken(accessToken)
	if err != nil {
		log.Printf("[LCEDA-AI][server][auth] access_token.invalid method=%s path=%s remote=%s error=%v",
			c.Request.Method, c.Request.URL.Path, c.ClientIP(), err)
		ginUnauthorized(c, err.Error())
		return
	}
	limit := 20
	if raw := c.Query("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	transactions, err := h.creditsService.ListTransactions(user.UserID, limit)
	if err != nil {
		ginInternalError(c, err)
		return
	}
	ginSuccess(c, map[string]any{"transactions": transactions})
}
