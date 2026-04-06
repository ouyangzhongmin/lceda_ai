package bootstrap

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"lceda_ai/server/internal/app"
	domainauth "lceda_ai/server/internal/domain/auth"
	domaincredits "lceda_ai/server/internal/domain/credits"
	"lceda_ai/server/internal/integration/email"
	"lceda_ai/server/internal/integration/embeddings"
	"lceda_ai/server/internal/integration/llmproviders"
	"lceda_ai/server/internal/integration/wechat"
	"lceda_ai/server/internal/repository/memory"
	"lceda_ai/server/internal/repository/persistence"
	pgrepo "lceda_ai/server/internal/repository/postgres"
	qdrantrepo "lceda_ai/server/internal/repository/qdrant"
	redisrepo "lceda_ai/server/internal/repository/redis"
	httptransport "lceda_ai/server/internal/transport/http"
	"lceda_ai/server/internal/transport/http/handlers"
	authusecase "lceda_ai/server/internal/usecase/auth"
	creditsusecase "lceda_ai/server/internal/usecase/credits"
	knowledgeusecase "lceda_ai/server/internal/usecase/knowledge"
	llmusecase "lceda_ai/server/internal/usecase/llm"
	ragusecase "lceda_ai/server/internal/usecase/rag"

	"github.com/jackc/pgx/v5/pgxpool"
	redisv9 "github.com/redis/go-redis/v9"
)

type infra struct {
	postgresPool *pgxpool.Pool
	redisClient  *redisv9.Client
}

type repositories struct {
	auth      domainauth.Repository
	credits   domaincredits.Repository
	llmLogs   llmLogRepository
	knowledge knowledgeRepository
}

type services struct {
	auth          *authusecase.Service
	credits       *creditsusecase.Service
	llm           *llmusecase.Service
	rag           *ragusecase.Service
	knowledge     *knowledgeusecase.Service
	knowledgeTask *knowledgeusecase.ImportTaskService
}

type routeHandlers struct {
	httptransport.RouteHandlers
	requestLogRepo httptransport.RequestLogRepository
}

func openInfra(cfg app.Config) infra {
	postgresPool, err := pgrepo.OpenPool(cfg.Database)
	if err != nil {
		postgresPool = nil
	}
	redisClient, err := redisrepo.OpenClient(cfg.Redis)
	if err != nil {
		redisClient = nil
	}
	return infra{
		postgresPool: postgresPool,
		redisClient:  redisClient,
	}
}

func buildRepositories(cfg app.Config, infra infra) repositories {
	repos := repositories{
		auth:      memory.NewAuthRepository(),
		credits:   memory.NewCreditsRepository(),
		llmLogs:   memory.NewLLMLogRepository(),
		knowledge: memory.NewKnowledgeRepository(),
	}
	if infra.postgresPool == nil {
		return repos
	}

	repos.credits = pgrepo.NewCreditsRepository(infra.postgresPool)
	repos.llmLogs = pgrepo.NewLLMLogRepository(infra.postgresPool)
	repos.knowledge = pgrepo.NewKnowledgeRepository(infra.postgresPool)
	repos.auth = persistence.NewAuthRepository(infra.postgresPool, infra.redisClient, cfg.Wechat.AppID)
	return repos
}

func buildServices(cfg app.Config, infra infra, repos repositories) services {
	wechatClient := wechat.NewClient(cfg.Wechat.AppID, cfg.Wechat.AppSecret, cfg.Wechat.RedirectURI)
	authService := authusecase.NewService(repos.auth, wechatClient, email.NewSMTPSender(cfg.SMTP))
	creditsService := creditsusecase.NewService(repos.credits)

	primaryAudit := buildPrimaryAuditWriter(infra)
	defaultProviderID, llmProviders, providerInfos := resolveLLMProviders(cfg)
	llmService := llmusecase.NewServiceWithProviders(
		defaultProviderID,
		llmProviders,
		providerInfos,
		repos.llmLogs,
		newAuditWriter(primaryAudit, "llm_request_logs.jsonl"),
	)
	vectorStore := resolveVectorStore(cfg)
	ragService := ragusecase.NewService(
		cfg.Memory.Collection,
		qdrantrepo.NewRetrieverAdapter(vectorStore),
		newAuditWriter(primaryAudit, "rag_citations.jsonl"),
	)
	knowledgeService := knowledgeusecase.NewService(
		repos.knowledge,
		newAuditWriter(primaryAudit, "knowledge_events.jsonl"),
	)
	knowledgeTaskService := buildKnowledgeTaskService(cfg, infra, knowledgeService)

	return services{
		auth:          authService,
		credits:       creditsService,
		llm:           llmService,
		rag:           ragService,
		knowledge:     knowledgeService,
		knowledgeTask: knowledgeTaskService,
	}
}

func buildRouteHandlers(cfg app.Config, infra infra, svc services) routeHandlers {
	var requestLogRepo httptransport.RequestLogRepository
	if infra.postgresPool != nil {
		requestLogRepo = pgrepo.NewRequestLogRepository(infra.postgresPool)
	}

	return routeHandlers{
		RouteHandlers: httptransport.RouteHandlers{
			Auth:          handlers.NewAuthHandler(svc.auth, cfg.Server.BaseURL),
			Credits:       handlers.NewCreditsHandler(svc.auth, svc.credits),
			Rag:           handlers.NewRagHandler(svc.rag),
			LLM:           handlers.NewLLMHandler(svc.auth, svc.credits, svc.llm),
			Knowledge:     handlers.NewKnowledgeHandler(svc.knowledge),
			KnowledgeTask: handlers.NewKnowledgeTaskHandler(svc.knowledgeTask),
		},
		requestLogRepo: requestLogRepo,
	}
}

func buildKnowledgeTaskService(cfg app.Config, infra infra, knowledgeService *knowledgeusecase.Service) *knowledgeusecase.ImportTaskService {
	var taskQueue knowledgeusecase.ImportTaskQueue = knowledgeusecase.NewInMemoryImportTaskQueue(256)
	var taskRepo knowledgeusecase.ImportTaskRepository = knowledgeusecase.NewInMemoryImportTaskRepository()

	if infra.redisClient != nil {
		hostName, _ := os.Hostname()
		consumerID := fmt.Sprintf("%s-%d", hostName, os.Getpid())
		if cfg.Knowledge.QueueMode == "list" {
			taskQueue = knowledgeusecase.NewRedisImportTaskQueue(infra.redisClient, "lceda:knowledge:import_tasks")
		} else {
			taskQueue = knowledgeusecase.NewRedisStreamImportTaskQueue(
				infra.redisClient,
				knowledgeusecase.RedisStreamImportTaskQueueOptions{
					Stream:        cfg.Knowledge.QueueStream,
					Group:         cfg.Knowledge.QueueGroup,
					Consumer:      consumerID,
					BlockTimeout:  time.Duration(cfg.Knowledge.QueueBlockMS) * time.Millisecond,
					ClaimMinIdle:  time.Duration(cfg.Knowledge.QueueClaimIdleMS) * time.Millisecond,
					ClaimEnabled:  cfg.Knowledge.QueueClaimEnabled == nil || *cfg.Knowledge.QueueClaimEnabled,
					ClaimCount:    int64(cfg.Knowledge.QueueClaimCount),
					ClaimInterval: time.Duration(cfg.Knowledge.QueueClaimIntervalMS) * time.Millisecond,
				},
			)
		}
	}

	if infra.postgresPool != nil {
		taskRepo = pgrepo.NewImportTaskRepository(infra.postgresPool)
	}

	taskService := knowledgeusecase.NewImportTaskServiceWithQueue(knowledgeService, taskQueue, taskRepo)
	taskService.SetTaskRetryPolicy(cfg.Knowledge.TaskMaxAttempts, time.Duration(cfg.Knowledge.TaskRetryDelayMS)*time.Millisecond)
	taskService.SetTaskRetryBackoffPolicy(cfg.Knowledge.TaskRetryBackoffMode, time.Duration(cfg.Knowledge.TaskRetryMaxDelayMS)*time.Millisecond)
	taskService.SetTaskLockTTL(time.Duration(cfg.Knowledge.TaskLockTTLMS) * time.Millisecond)
	taskService.SetAckRetryPolicy(cfg.Knowledge.AckRetryCount, time.Duration(cfg.Knowledge.AckRetryIntervalMS)*time.Millisecond)
	if infra.redisClient != nil {
		taskService.SetTaskLocker(knowledgeusecase.NewRedisImportTaskLocker(infra.redisClient, "lceda:knowledge:import_task_lock:"))
	}
	taskService.StartWorker()
	return taskService
}

func buildPrimaryAuditWriter(infra infra) pgrepo.AuditWriter {
	if infra.postgresPool == nil {
		return nil
	}
	return pgrepo.NewPGAuditWriter(infra.postgresPool)
}

func newAuditWriter(primary pgrepo.AuditWriter, fileName string) pgrepo.AuditWriter {
	return pgrepo.NewFailoverAuditWriter(
		primary,
		pgrepo.NewJSONLAuditWriter(filepath.Join("data", "audit", fileName)),
	)
}

func resolveVectorStore(cfg app.Config) qdrantrepo.VectorStore {
	inMemory := qdrantrepo.NewInMemoryVectorStore()
	if cfg.Memory.EmbeddingProvider == "qwen" && cfg.LLM.Qwen.APIKey != "" {
		embedder := embeddings.NewOpenAICompatibleEmbedder(cfg.LLM.Qwen.Endpoint, cfg.LLM.Qwen.APIKey, cfg.Memory.EmbeddingModel)
		qdrantStore := qdrantrepo.NewQdrantVectorStore(cfg.Memory.QdrantURL, cfg.Memory.QdrantAPIKey, cfg.Memory.Collection, embedder)
		if cfg.Memory.EnableFallback == nil || *cfg.Memory.EnableFallback {
			return qdrantrepo.NewFallbackVectorStore(qdrantStore, inMemory)
		}
		return qdrantStore
	}
	return inMemory
}

func resolveLLMProviders(cfg app.Config) (string, map[string]llmproviders.Provider, []llmusecase.ProviderInfo) {
	timeout := time.Duration(cfg.LLM.RequestTimeoutMS) * time.Millisecond
	retryBackoff := time.Duration(cfg.LLM.RetryBackoffMS) * time.Millisecond
	providers := map[string]llmproviders.Provider{}
	infos := make([]llmusecase.ProviderInfo, 0, 5)
	register := func(id string, label string, cfgProvider app.ProviderConfig) {
		enabled := strings.TrimSpace(cfgProvider.Endpoint) != "" && strings.TrimSpace(cfgProvider.APIKey) != ""
		info := llmusecase.ProviderInfo{
			ID:           id,
			Label:        label,
			Enabled:      enabled,
			DefaultModel: cfgProvider.Model,
			Models:       compactModels(cfgProvider.Model),
		}
		infos = append(infos, info)
		if !enabled {
			return
		}
		var provider llmproviders.Provider
		provider = llmproviders.NewOpenAICompatibleProviderWithOptions(id, cfgProvider.Endpoint, cfgProvider.APIKey, cfgProvider.Model, timeout, cfg.LLM.RetryCount, retryBackoff)
		if cfg.LLM.EnableFallback == nil || *cfg.LLM.EnableFallback {
			provider = llmproviders.NewFallbackProvider(provider, llmproviders.NewDemoProvider())
		}
		providers[id] = provider
		log.Printf("[LCEDA-AI][server][llm] provider.available id=%s enabled=%t default_model=%s resolved_name=%s",
			id, enabled, cfgProvider.Model, provider.Name())
	}
	register("openai", "OpenAI Compatible", cfg.LLM.OpenAI)
	register("qwen", "Qwen", cfg.LLM.Qwen)
	register("deepseek", "DeepSeek", cfg.LLM.DeepSeek)
	register("kimi", "Kimi", cfg.LLM.Kimi)
	register("doubao", "Doubao", cfg.LLM.Doubao)
	defaultID := cfg.LLM.Provider
	if defaultID == "openai-compatible" || defaultID == "" {
		defaultID = "openai"
	}
	if _, ok := providers[defaultID]; !ok {
		log.Printf("[LCEDA-AI][server][llm] provider.default_unavailable requested=%s fallback_enabled=%t", defaultID, cfg.LLM.EnableFallback == nil || *cfg.LLM.EnableFallback)
		providers["demo"] = llmproviders.NewDemoProvider()
		infos = append(infos, llmusecase.ProviderInfo{
			ID:           "demo",
			Label:        "Demo",
			Enabled:      true,
			DefaultModel: "demo-llm",
			Models:       []string{"demo-llm"},
		})
		defaultID = "demo"
	} else {
		log.Printf("[LCEDA-AI][server][llm] provider.selected provider=%s fallback_enabled=%t timeout_ms=%d retry_count=%d",
			defaultID, cfg.LLM.EnableFallback == nil || *cfg.LLM.EnableFallback, cfg.LLM.RequestTimeoutMS, cfg.LLM.RetryCount)
	}
	log.Printf("[LCEDA-AI][server][llm] provider.registry_ready default=%s count=%d", defaultID, len(providers))
	return defaultID, providers, infos
}

func compactModels(values ...string) []string {
	models := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		models = append(models, trimmed)
	}
	return models
}
