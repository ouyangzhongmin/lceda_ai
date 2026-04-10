package handlers

import (
	authusecase "lceda_ai/server/internal/usecase/auth"
	creditsusecase "lceda_ai/server/internal/usecase/credits"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
	llmusecase "lceda_ai/server/internal/usecase/llm"
	ragusecase "lceda_ai/server/internal/usecase/rag"
)

type authService interface {
	CreateLoginSession(baseURL string) (*authusecase.LoginSession, error)
	GetLoginSessionWithWait(sessionID, pollToken string, waitSeconds int) (*authusecase.LoginSession, error)
	SendEmailCode(sessionID, email string) error
	VerifyEmailCode(sessionID, email, code string) (*authusecase.LoginSession, error)
	ExchangeToken(sessionID, exchangeToken string) (authusecase.User, authusecase.TokenPair, error)
	RefreshToken(refreshToken string) (authusecase.User, authusecase.TokenPair, error)
	GetUserByAccessToken(accessToken string) (authusecase.User, error)
	Logout(accessToken string, allDevices bool) error
	BuildWechatAuthorizeURL(sessionID string) (string, string, error)
	CompleteWechatLogin(state, wechatCode string) (*authusecase.LoginSession, error)
	BindWechat(accessToken, bindTicket string) (authusecase.User, error)
}

type creditsService interface {
	GetBalance(userID string) (creditsusecase.Balance, error)
	ListTransactions(userID string, limit int) ([]creditsusecase.Transaction, error)
	Consume(userID string, amount int64, scene string, relatedObjectType string, relatedObjectUID string, remark string) (creditsusecase.Transaction, error)
}

type ragService interface {
	Search(query string, topK int) ([]ragusecase.SearchResult, error)
	BuildCitationPackage(query string, topK int) (ragusecase.CitationPackage, error)
	ProviderName() string
}

type knowledgeService interface {
	Import(req knowledgeusecase.ImportRequest) (knowledgeusecase.ImportResult, error)
	ListDocuments(limit int) ([]knowledgeusecase.Document, error)
	Reindex(documentUID string) (knowledgeusecase.ReindexResult, bool, error)
}

type knowledgeTaskService interface {
	CreateTask(req knowledgeusecase.ImportTaskRequest) (knowledgeusecase.ImportTask, error)
	GetTask(taskUID string) (knowledgeusecase.ImportTask, bool, error)
	RunTask(taskUID string) (knowledgeusecase.ImportTask, bool, error)
	EnqueueTask(taskUID string) (knowledgeusecase.ImportTask, bool, error)
	RetryTaskStrict(taskUID string) (knowledgeusecase.ImportTask, bool, error)
	Stats() knowledgeusecase.ImportTaskStats
	ListDeadLetters(limit int) []knowledgeusecase.DeadLetterRecord
}

type llmService interface {
	Generate(req llmusecase.GenerateRequest) (llmusecase.CompletionResult, error)
	StreamGenerate(
		req llmusecase.GenerateRequest,
		onDelta func(text string),
		onReasoningDelta func(text string),
	) (llmusecase.CompletionResult, error)
	ListLogs(userID string, limit int) []llmusecase.RequestLog
	ListProviders() []llmusecase.ProviderInfo
}
