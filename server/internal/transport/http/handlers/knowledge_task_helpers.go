package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
)

func (h *KnowledgeTaskHandler) executeTaskAction(taskUID string, action string) (knowledgeusecase.ImportTask, bool, error) {
	switch action {
	case ":run":
		return h.service.RunTask(taskUID)
	case ":enqueue":
		return h.service.EnqueueTask(taskUID)
	default:
		return h.service.RetryTaskStrict(taskUID)
	}
}

func writeRetryTaskError(c *gin.Context, err error) {
	if err.Error() != "task is not in dead-letter state" {
		ginInternalError(c, err)
		return
	}
	ginErrorWithDetail(c, http.StatusConflict, 409001, "task is not eligible for retry", err.Error())
}
