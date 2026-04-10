package httptransport

import (
	"lceda_ai/server/internal/transport/http/handlers"

	"github.com/gin-gonic/gin"
)

type RouteHandlers struct {
	Auth          *handlers.AuthHandler
	Credits       *handlers.CreditsHandler
	Rag           *handlers.RagHandler
	LLM           *handlers.LLMHandler
	Knowledge     *handlers.KnowledgeHandler
	KnowledgeTask *handlers.KnowledgeTaskHandler
}

func NewRouter(h RouteHandlers, middleware ...gin.HandlerFunc) *gin.Engine {
	router := gin.Default()
	gin.SetMode(gin.DebugMode)
	if len(middleware) > 0 {
		router.Use(middleware...)
	}

	router.GET("/healthz", handlers.Healthz)
	router.GET("/api/v1/debug/ping", handlers.DebugPing)
	router.GET("/login", h.Auth.LoginPage)

	auth := router.Group("/api/v1/auth")
	auth.POST("/login-sessions", h.Auth.CreateLoginSession)
	auth.GET("/login-sessions/:id", h.Auth.GetLoginSession)
	auth.POST("/email/send-code", h.Auth.SendEmailCode)
	auth.POST("/email/verify-code", h.Auth.VerifyEmailCode)
	auth.POST("/wechat/login-url", h.Auth.WechatLoginURL)
	auth.GET("/wechat/callback", h.Auth.WechatCallback)
	auth.POST("/wechat/bind", h.Auth.WechatBind)
	auth.POST("/tokens:action", h.Auth.TokenAction)
	auth.POST("/logout", h.Auth.Logout)

	router.GET("/api/v1/users/me", h.Auth.GetCurrentUser)

	credits := router.Group("/api/v1/credits")
	credits.GET("/balance", h.Credits.GetBalance)
	credits.GET("/transactions", h.Credits.ListTransactions)

	rag := router.Group("/api/v1/rag")
	rag.POST("/search", h.Rag.Search)
	rag.POST("/citations:build", h.Rag.BuildCitations)
	rag.GET("/providers", h.Rag.Providers)

	llm := router.Group("/api/v1/llm")
	llm.POST("/generate", h.LLM.Generate)
	llm.POST("/generate/stream", h.LLM.GenerateStream)
	llm.GET("/logs", h.LLM.ListLogs)
	llm.GET("/providers", h.LLM.ListProviders)

	knowledge := router.Group("/api/v1/knowledge")
	knowledge.POST("/documents", h.Knowledge.ImportDocument)
	knowledge.GET("/documents", h.Knowledge.ListDocuments)
	knowledge.POST("/documents/:id/reindex", h.Knowledge.ReindexDocument)
	knowledge.POST("/import-tasks", h.KnowledgeTask.CreateTask)
	knowledge.GET("/import-tasks/stats", h.KnowledgeTask.GetStats)
	knowledge.GET("/import-tasks/dead-letters", h.KnowledgeTask.GetDeadLetters)
	knowledge.GET("/import-tasks/:id", h.KnowledgeTask.GetTask)
	knowledge.POST("/import-tasks/:id/run", h.KnowledgeTask.RunTask)
	knowledge.POST("/import-tasks/:id/enqueue", h.KnowledgeTask.EnqueueTask)
	knowledge.POST("/import-tasks/:id/retry", h.KnowledgeTask.RetryTask)

	return router
}
