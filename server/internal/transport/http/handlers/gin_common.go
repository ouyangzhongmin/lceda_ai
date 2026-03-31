package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func ginWriteJSON(c *gin.Context, status int, payload map[string]any) {
	c.JSON(status, payload)
}

func ginSuccess(c *gin.Context, data any) {
	ginWriteJSON(c, http.StatusOK, map[string]any{
		"code":    0,
		"message": "success",
		"data":    data,
	})
}

func ginError(c *gin.Context, status int, code int, message string) {
	ginWriteJSON(c, status, map[string]any{
		"code":    code,
		"message": message,
	})
}

func ginErrorWithDetail(c *gin.Context, status int, code int, message string, detail string) {
	ginWriteJSON(c, status, map[string]any{
		"code":    code,
		"message": message,
		"error": map[string]any{
			"detail": detail,
		},
	})
}

func ginInvalidBody(c *gin.Context) {
	ginError(c, http.StatusBadRequest, 400000, "invalid request body")
}

func ginBadRequest(c *gin.Context, message string) {
	ginError(c, http.StatusBadRequest, 400000, message)
}

func ginUnauthorized(c *gin.Context, message string) {
	ginError(c, http.StatusUnauthorized, 401001, message)
}

func ginMissingAccessToken(c *gin.Context) {
	ginError(c, http.StatusUnauthorized, 401000, "missing access token")
}

func ginInternalError(c *gin.Context, err error) {
	ginError(c, http.StatusInternalServerError, 500000, err.Error())
}

func ginNotFound(c *gin.Context, message string) {
	ginError(c, http.StatusNotFound, 404000, message)
}

func ginBadGateway(c *gin.Context, err error) {
	ginError(c, http.StatusBadGateway, 502001, err.Error())
}

func ginMethodNotAllowed(c *gin.Context) {
	ginError(c, http.StatusMethodNotAllowed, 400000, "method not allowed")
}

func ginBearerToken(c *gin.Context) (string, bool) {
	const prefix = "Bearer "

	header := strings.TrimSpace(c.GetHeader("Authorization"))
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}

	token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
	if token == "" {
		return "", false
	}
	return token, true
}
