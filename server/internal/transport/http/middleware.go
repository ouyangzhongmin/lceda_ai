package httptransport

import (
	"time"

	"github.com/gin-gonic/gin"
)

func NewRequestLogMiddleware(repo RequestLogRepository, authService accessTokenUserResolver) gin.HandlerFunc {
	return func(c *gin.Context) {
		startedAt := time.Now()
		c.Next()

		if repo == nil {
			return
		}

		entry := buildRequestLogEntry(c, startedAt, resolveRequestLogUserID(c, authService))
		_ = repo.Save(entry)
	}
}
