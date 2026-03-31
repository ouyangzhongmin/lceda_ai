package bootstrap

import (
	"github.com/gin-gonic/gin"
	"lceda_ai/server/internal/app"
	httptransport "lceda_ai/server/internal/transport/http"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
	llmusecase "lceda_ai/server/internal/usecase/llm"
)

type Server struct {
	Router  *gin.Engine
	cleanup func()
}

func (s *Server) Close() {
	if s.cleanup != nil {
		s.cleanup()
	}
}

func NewServer(cfg app.Config) (*Server, error) {
	infra := openInfra(cfg)
	repos := buildRepositories(cfg, infra)
	svc := buildServices(cfg, infra, repos)
	routeHandlers := buildRouteHandlers(cfg, infra, svc)
	router := httptransport.NewRouter(
		routeHandlers.RouteHandlers,
		httptransport.NewRequestLogMiddleware(routeHandlers.requestLogRepo, svc.auth),
	)

	return &Server{
		Router: router,
		cleanup: func() {
			svc.knowledgeTask.StopWorker()
			if infra.redisClient != nil {
				_ = infra.redisClient.Close()
			}
			if infra.postgresPool != nil {
				infra.postgresPool.Close()
			}
		},
	}, nil
}

type llmLogRepository interface {
	SaveLog(log llmusecase.RequestLog) error
	ListLogs(userID string, limit int) []llmusecase.RequestLog
}

type knowledgeRepository interface {
	FindDocumentBySourceKey(sourceKey string) (knowledgeusecase.Document, bool)
	FindContentHash(documentUID string) (uint64, bool)
	SaveDocument(document knowledgeusecase.Document, sourceKey string, contentHash uint64) error
	FindDocument(documentUID string) (knowledgeusecase.Document, bool)
	ListDocuments(limit int) []knowledgeusecase.Document
	SaveChunks(documentUID string, chunks []knowledgeusecase.Chunk) error
	ListChunks(documentUID string) []knowledgeusecase.Chunk
}
