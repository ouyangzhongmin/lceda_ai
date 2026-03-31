package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func Healthz(c *gin.Context) {
	ginWriteJSON(c, http.StatusOK, map[string]any{
		"code":    0,
		"message": "ok",
		"data": map[string]string{
			"service": "lceda-ai-server",
		},
	})
}

func DebugPing(c *gin.Context) {
	ginWriteJSON(c, http.StatusOK, map[string]any{
		"code":    0,
		"message": "success",
		"data": map[string]any{
			"pong":    true,
			"service": "lceda-ai-server",
		},
	})
}
