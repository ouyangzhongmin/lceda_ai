package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	authusecase "lceda_ai/server/internal/usecase/auth"
)

func currentAccessToken(c *gin.Context) (string, bool) {
	accessToken, ok := ginBearerToken(c)
	if !ok {
		log.Printf("[LCEDA-AI][server][auth] access_token.missing method=%s path=%s remote=%s user_agent=%q",
			c.Request.Method, c.Request.URL.Path, c.ClientIP(), c.Request.UserAgent())
		ginMissingAccessToken(c)
		return "", false
	}
	return accessToken, true
}

func (h *AuthHandler) currentUser(c *gin.Context) (authusecase.User, bool) {
	accessToken, ok := currentAccessToken(c)
	if !ok {
		return authusecase.User{}, false
	}

	user, err := h.service.GetUserByAccessToken(accessToken)
	if err != nil {
		log.Printf("[LCEDA-AI][server][auth] access_token.invalid method=%s path=%s remote=%s error=%v",
			c.Request.Method, c.Request.URL.Path, c.ClientIP(), err)
		ginUnauthorized(c, err.Error())
		return authusecase.User{}, false
	}
	return user, true
}

func bindJSONOrAbort[T any](c *gin.Context, target *T) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		ginInvalidBody(c)
		return false
	}
	return true
}

func writeAuthFlowError(c *gin.Context, err error, badRequestCode int, invalidErrs ...error) {
	status := http.StatusBadRequest
	code := badRequestCode
	for _, invalidErr := range invalidErrs {
		if err == invalidErr {
			ginError(c, status, code, err.Error())
			return
		}
	}
	ginInternalError(c, err)
}

func writeUnauthorizedOrInternal(c *gin.Context, err error, unauthorizedErr error) {
	if err == unauthorizedErr {
		log.Printf("[LCEDA-AI][server][auth] unauthorized method=%s path=%s remote=%s error=%v",
			c.Request.Method, c.Request.URL.Path, c.ClientIP(), err)
		ginUnauthorized(c, err.Error())
		return
	}
	ginInternalError(c, err)
}
