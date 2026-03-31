package httptransport

import (
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"lceda_ai/server/internal/pkg/idgen"
)

func buildRequestLogEntry(c *gin.Context, startedAt time.Time, userID string) RequestLogEntry {
	return RequestLogEntry{
		RequestID:  idgen.New("req"),
		UserID:     userID,
		Path:       c.FullPath(),
		Method:     c.Request.Method,
		StatusCode: c.Writer.Status(),
		ClientIP:   c.ClientIP(),
		UserAgent:  c.Request.UserAgent(),
		LatencyMS:  int(time.Since(startedAt).Milliseconds()),
		CreatedAt:  startedAt,
	}
}

func resolveRequestLogUserID(c *gin.Context, authService accessTokenUserResolver) string {
	if authService == nil {
		return ""
	}

	accessToken := bearerTokenFromHeader(c.GetHeader("Authorization"))
	if accessToken == "" {
		return ""
	}

	user, err := authService.GetUserByAccessToken(accessToken)
	if err != nil {
		return ""
	}
	return user.UserID
}

func bearerTokenFromHeader(value string) string {
	const prefix = "Bearer "

	header := strings.TrimSpace(value)
	if !strings.HasPrefix(header, prefix) {
		return ""
	}

	token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
	if token == "" {
		return ""
	}
	return token
}
