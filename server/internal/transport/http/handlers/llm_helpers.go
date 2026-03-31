package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	authusecase "lceda_ai/server/internal/usecase/auth"
	creditsusecase "lceda_ai/server/internal/usecase/credits"
)

func (h *LLMHandler) currentUser(c *gin.Context) (authusecase.User, bool) {
	accessToken, ok := currentAccessToken(c)
	if !ok {
		return authusecase.User{}, false
	}
	user, err := h.authService.GetUserByAccessToken(accessToken)
	if err != nil {
		ginUnauthorized(c, err.Error())
		return authusecase.User{}, false
	}
	return user, true
}

func writeCreditsConsumeError(c *gin.Context, err error) {
	status := http.StatusBadRequest
	code := 400000
	if err == creditsusecase.ErrInsufficientBalance {
		status = http.StatusPaymentRequired
		code = 402001
	}
	ginError(c, status, code, err.Error())
}
