package app

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server    ServerConfig
	Database  DatabaseConfig
	Redis     RedisConfig
	SMTP      SMTPConfig
	Memory    MemoryConfig
	LLM       LLMConfig
	Wechat    WechatConfig
	Knowledge KnowledgeConfig
}

type ServerConfig struct {
	Port    string
	BaseURL string
}

type DatabaseConfig struct {
	DSN      string
	Host     string
	Port     string
	Name     string
	User     string
	Password string
	SSLMode  string
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

type SMTPConfig struct {
	Host string
	Port int
	User string
	Pass string
	TLS  *bool
	From string
}

type MemoryConfig struct {
	QdrantURL         string
	QdrantAPIKey      string
	Collection        string
	EmbeddingProvider string
	EmbeddingModel    string
	TopK              int
	EnableFallback    *bool
}

type LLMConfig struct {
	Provider         string
	AMapAPIKey       string
	EnableFallback   *bool
	RequestTimeoutMS int
	RetryCount       int
	RetryBackoffMS   int
	OpenAI           ProviderConfig
	Qwen             ProviderConfig
	DeepSeek         ProviderConfig
	Kimi             ProviderConfig
	Doubao           ProviderConfig
}

type ProviderConfig struct {
	Endpoint string
	APIKey   string
	Model    string
}

type WechatConfig struct {
	AppID       string
	AppSecret   string
	RedirectURI string
}

type KnowledgeConfig struct {
	QueueMode            string
	QueueStream          string
	QueueGroup           string
	QueueBlockMS         int
	QueueClaimIdleMS     int
	QueueClaimEnabled    *bool
	QueueClaimCount      int
	QueueClaimIntervalMS int
	TaskMaxAttempts      int
	TaskRetryDelayMS     int
	TaskRetryBackoffMode string
	TaskRetryMaxDelayMS  int
	TaskLockTTLMS        int
	AckRetryCount        int
	AckRetryIntervalMS   int
}

func LoadConfig() (Config, error) {
	fileCfg, err := loadFromYAMLIfPresent(os.Getenv("APP_CONFIG"))
	if err != nil {
		return Config{}, err
	}

	port := firstNonEmpty(fileCfg.Server.Port, "8080")
	if envPort := os.Getenv("PORT"); envPort != "" {
		port = envPort
	}
	baseURL := firstNonEmpty(fileCfg.Server.BaseURL, "http://127.0.0.1:"+port)
	if envBaseURL := os.Getenv("BASE_URL"); envBaseURL != "" {
		baseURL = envBaseURL
	}

	if fileCfg.Server.Port != "" {
		// Keep the default base URL aligned when YAML sets port only.
		if fileCfg.Server.BaseURL == "" && os.Getenv("BASE_URL") == "" {
			baseURL = "http://127.0.0.1:" + port
		}
	}

	topK := 5
	if fileCfg.Memory.TopK > 0 {
		topK = fileCfg.Memory.TopK
	}
	if rawTopK := os.Getenv("MEMORY_TOP_K"); rawTopK != "" {
		parsed, err := strconv.Atoi(rawTopK)
		if err != nil {
			return Config{}, errors.New("invalid MEMORY_TOP_K")
		}
		topK = parsed
	}

	cfg := Config{
		Server: ServerConfig{
			Port:    port,
			BaseURL: baseURL,
		},
		Database: DatabaseConfig{
			DSN:      firstNonEmpty(os.Getenv("DB_DSN"), fileCfg.Database.DSN),
			Host:     firstNonEmpty(os.Getenv("DB_HOST"), firstNonEmpty(fileCfg.Database.Host, "127.0.0.1")),
			Port:     firstNonEmpty(os.Getenv("DB_PORT"), firstNonEmpty(fileCfg.Database.Port, "15432")),
			Name:     firstNonEmpty(os.Getenv("DB_NAME"), firstNonEmpty(fileCfg.Database.Name, "lceda_ai")),
			User:     firstNonEmpty(os.Getenv("DB_USER"), firstNonEmpty(fileCfg.Database.User, "lceda")),
			Password: firstNonEmpty(os.Getenv("DB_PASSWORD"), firstNonEmpty(fileCfg.Database.Password, "lceda_dev_password")),
			SSLMode:  firstNonEmpty(os.Getenv("DB_SSLMODE"), firstNonEmpty(fileCfg.Database.SSLMode, "disable")),
		},
		Redis: RedisConfig{
			Addr:     firstNonEmpty(os.Getenv("REDIS_ADDR"), firstNonEmpty(fileCfg.Redis.Addr, "127.0.0.1:16379")),
			Password: firstNonEmpty(os.Getenv("REDIS_PASSWORD"), firstNonEmpty(fileCfg.Redis.Password, "lceda_redis_dev_password")),
			DB:       resolveInt("REDIS_DB", fileCfg.Redis.DB, 0),
		},
		SMTP: SMTPConfig{
			Host: firstNonEmpty(os.Getenv("SMTP_HOST"), fileCfg.SMTP.Host),
			Port: resolveInt("SMTP_PORT", fileCfg.SMTP.Port, 465),
			User: firstNonEmpty(os.Getenv("SMTP_USER"), fileCfg.SMTP.User),
			Pass: firstNonEmpty(os.Getenv("SMTP_PASS"), fileCfg.SMTP.Pass),
			TLS:  boolPtr(resolveBool("SMTP_TLS", fileCfg.SMTP.TLS, true)),
			From: firstNonEmpty(os.Getenv("SMTP_FROM"), firstNonEmpty(fileCfg.SMTP.From, fileCfg.SMTP.User)),
		},
		Memory: MemoryConfig{
			QdrantURL:         firstNonEmpty(os.Getenv("MEMORY_QDRANT_URL"), firstNonEmpty(fileCfg.Memory.QdrantURL, "http://127.0.0.1:6333")),
			QdrantAPIKey:      firstNonEmpty(os.Getenv("MEMORY_QDRANT_API_KEY"), fileCfg.Memory.QdrantAPIKey),
			Collection:        firstNonEmpty(os.Getenv("MEMORY_COLLECTION"), firstNonEmpty(fileCfg.Memory.Collection, "lceda_ai_memory")),
			EmbeddingProvider: firstNonEmpty(os.Getenv("MEMORY_EMBEDDING_PROVIDER"), firstNonEmpty(fileCfg.Memory.EmbeddingProvider, "qwen")),
			EmbeddingModel:    firstNonEmpty(os.Getenv("MEMORY_EMBEDDING_MODEL"), firstNonEmpty(fileCfg.Memory.EmbeddingModel, "text-embedding-v4")),
			TopK:              topK,
			EnableFallback:    boolPtr(resolveBool("MEMORY_ENABLE_FALLBACK", fileCfg.Memory.EnableFallback, true)),
		},
		LLM: LLMConfig{
			Provider:         strings.ToLower(firstNonEmpty(os.Getenv("LLM_PROVIDER"), firstNonEmpty(fileCfg.LLM.Provider, "doubao"))),
			AMapAPIKey:       firstNonEmpty(os.Getenv("LLM_AMAP_API_KEY"), fileCfg.LLM.AMapAPIKey),
			EnableFallback:   boolPtr(resolveBool("LLM_ENABLE_FALLBACK", fileCfg.LLM.EnableFallback, true)),
			RequestTimeoutMS: resolveInt("LLM_REQUEST_TIMEOUT_MS", fileCfg.LLM.RequestTimeoutMS, 25000),
			RetryCount:       resolveInt("LLM_RETRY_COUNT", fileCfg.LLM.RetryCount, 1),
			RetryBackoffMS:   resolveInt("LLM_RETRY_BACKOFF_MS", fileCfg.LLM.RetryBackoffMS, 300),
			OpenAI: ProviderConfig{
				Endpoint: firstNonEmpty(os.Getenv("LLM_OPENAI_ENDPOINT"), firstNonEmpty(fileCfg.LLM.OpenAI.Endpoint, "https://api.openai.com/v1")),
				APIKey:   firstNonEmpty(os.Getenv("LLM_OPENAI_APIKEY"), fileCfg.LLM.OpenAI.APIKey),
				Model:    firstNonEmpty(os.Getenv("LLM_OPENAI_MODEL"), firstNonEmpty(fileCfg.LLM.OpenAI.Model, "gpt-4o-mini")),
			},
			Qwen: ProviderConfig{
				Endpoint: firstNonEmpty(os.Getenv("LLM_QWEN_ENDPOINT"), firstNonEmpty(fileCfg.LLM.Qwen.Endpoint, "https://dashscope.aliyuncs.com/compatible-mode/v1")),
				APIKey:   firstNonEmpty(os.Getenv("LLM_QWEN_APIKEY"), fileCfg.LLM.Qwen.APIKey),
				Model:    firstNonEmpty(os.Getenv("LLM_QWEN_MODEL"), firstNonEmpty(fileCfg.LLM.Qwen.Model, "qwen-plus")),
			},
			DeepSeek: ProviderConfig{
				Endpoint: firstNonEmpty(os.Getenv("LLM_DEEPSEEK_ENDPOINT"), firstNonEmpty(fileCfg.LLM.DeepSeek.Endpoint, "https://api.deepseek.com/v1")),
				APIKey:   firstNonEmpty(os.Getenv("LLM_DEEPSEEK_APIKEY"), fileCfg.LLM.DeepSeek.APIKey),
				Model:    firstNonEmpty(os.Getenv("LLM_DEEPSEEK_MODEL"), firstNonEmpty(fileCfg.LLM.DeepSeek.Model, "deepseek-chat")),
			},
			Kimi: ProviderConfig{
				Endpoint: firstNonEmpty(os.Getenv("LLM_KIMI_ENDPOINT"), firstNonEmpty(fileCfg.LLM.Kimi.Endpoint, "https://api.moonshot.cn/v1")),
				APIKey:   firstNonEmpty(os.Getenv("LLM_KIMI_APIKEY"), fileCfg.LLM.Kimi.APIKey),
				Model:    firstNonEmpty(os.Getenv("LLM_KIMI_MODEL"), firstNonEmpty(fileCfg.LLM.Kimi.Model, "moonshot-v1-8k")),
			},
			Doubao: ProviderConfig{
				Endpoint: firstNonEmpty(os.Getenv("LLM_DOUBAO_ENDPOINT"), firstNonEmpty(fileCfg.LLM.Doubao.Endpoint, "https://ark.cn-beijing.volces.com/api/v3")),
				APIKey:   firstNonEmpty(os.Getenv("LLM_DOUBAO_APIKEY"), fileCfg.LLM.Doubao.APIKey),
				Model:    firstNonEmpty(os.Getenv("LLM_DOUBAO_MODEL"), firstNonEmpty(fileCfg.LLM.Doubao.Model, "doubao-seed-2-0-mini-250821")),
			},
		},
		Wechat: WechatConfig{
			AppID:       firstNonEmpty(os.Getenv("WECHAT_APP_ID"), fileCfg.Wechat.AppID),
			AppSecret:   firstNonEmpty(os.Getenv("WECHAT_APP_SECRET"), fileCfg.Wechat.AppSecret),
			RedirectURI: firstNonEmpty(os.Getenv("WECHAT_REDIRECT_URI"), fileCfg.Wechat.RedirectURI),
		},
		Knowledge: KnowledgeConfig{
			QueueMode:            strings.ToLower(firstNonEmpty(os.Getenv("KNOWLEDGE_QUEUE_MODE"), firstNonEmpty(fileCfg.Knowledge.QueueMode, "stream"))),
			QueueStream:          firstNonEmpty(os.Getenv("KNOWLEDGE_QUEUE_STREAM"), firstNonEmpty(fileCfg.Knowledge.QueueStream, "lceda:knowledge:import_tasks:stream")),
			QueueGroup:           firstNonEmpty(os.Getenv("KNOWLEDGE_QUEUE_GROUP"), firstNonEmpty(fileCfg.Knowledge.QueueGroup, "lceda_import_task_workers")),
			QueueBlockMS:         resolveInt("KNOWLEDGE_QUEUE_BLOCK_MS", fileCfg.Knowledge.QueueBlockMS, 2000),
			QueueClaimIdleMS:     resolveInt("KNOWLEDGE_QUEUE_CLAIM_IDLE_MS", fileCfg.Knowledge.QueueClaimIdleMS, 30000),
			QueueClaimEnabled:    boolPtr(resolveBool("KNOWLEDGE_QUEUE_CLAIM_ENABLED", fileCfg.Knowledge.QueueClaimEnabled, true)),
			QueueClaimCount:      resolveInt("KNOWLEDGE_QUEUE_CLAIM_COUNT", fileCfg.Knowledge.QueueClaimCount, 1),
			QueueClaimIntervalMS: resolveInt("KNOWLEDGE_QUEUE_CLAIM_INTERVAL_MS", fileCfg.Knowledge.QueueClaimIntervalMS, 2000),
			TaskMaxAttempts:      resolveInt("KNOWLEDGE_TASK_MAX_ATTEMPTS", fileCfg.Knowledge.TaskMaxAttempts, 3),
			TaskRetryDelayMS:     resolveInt("KNOWLEDGE_TASK_RETRY_DELAY_MS", fileCfg.Knowledge.TaskRetryDelayMS, 2000),
			TaskRetryBackoffMode: strings.ToLower(firstNonEmpty(os.Getenv("KNOWLEDGE_TASK_RETRY_BACKOFF_MODE"), firstNonEmpty(fileCfg.Knowledge.TaskRetryBackoffMode, "fixed"))),
			TaskRetryMaxDelayMS:  resolveInt("KNOWLEDGE_TASK_RETRY_MAX_DELAY_MS", fileCfg.Knowledge.TaskRetryMaxDelayMS, 30000),
			TaskLockTTLMS:        resolveInt("KNOWLEDGE_TASK_LOCK_TTL_MS", fileCfg.Knowledge.TaskLockTTLMS, 60000),
			AckRetryCount:        resolveInt("KNOWLEDGE_ACK_RETRY_COUNT", fileCfg.Knowledge.AckRetryCount, 2),
			AckRetryIntervalMS:   resolveInt("KNOWLEDGE_ACK_RETRY_INTERVAL_MS", fileCfg.Knowledge.AckRetryIntervalMS, 200),
		},
	}
	fmt.Printf("config::::%#v", cfg)
	return cfg, nil
}

func firstNonEmpty(value string, fallback string) string {
	if value == "" {
		return fallback
	}

	return value
}

func loadFromYAMLIfPresent(path string) (Config, error) {
	if path == "" {
		return Config{}, nil
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}

	var parsed struct {
		Server struct {
			Port    string `yaml:"port"`
			BaseURL string `yaml:"base_url"`
		} `yaml:"server"`
		Database struct {
			DSN      string `yaml:"dsn"`
			Host     string `yaml:"host"`
			Port     string `yaml:"port"`
			Name     string `yaml:"name"`
			User     string `yaml:"user"`
			Password string `yaml:"password"`
			SSLMode  string `yaml:"sslmode"`
		} `yaml:"database"`
		Redis struct {
			Addr     string `yaml:"addr"`
			Password string `yaml:"password"`
			DB       int    `yaml:"db"`
		} `yaml:"redis"`
		SMTP struct {
			Host string `yaml:"host"`
			Port int    `yaml:"port"`
			User string `yaml:"user"`
			Pass string `yaml:"pass"`
			TLS  *bool  `yaml:"tls"`
			From string `yaml:"from"`
		} `yaml:"smtp"`
		Memory struct {
			QdrantURL         string `yaml:"qdrant_url"`
			QdrantAPIKey      string `yaml:"qdrant_api_key"`
			Collection        string `yaml:"collection"`
			EmbeddingProvider string `yaml:"embedding_provider"`
			EmbeddingModel    string `yaml:"embedding_model"`
			TopK              int    `yaml:"top_k"`
			EnableFallback    *bool  `yaml:"enable_fallback"`
		} `yaml:"memory"`
		LLM struct {
			Provider         string `yaml:"provider"`
			AMapAPIKey       string `yaml:"amap_api_key"`
			EnableFallback   *bool  `yaml:"enable_fallback"`
			RequestTimeoutMS int    `yaml:"request_timeout_ms"`
			RetryCount       int    `yaml:"retry_count"`
			RetryBackoffMS   int    `yaml:"retry_backoff_ms"`
			OpenAI           struct {
				Endpoint string `yaml:"endpoint"`
				APIKey   string `yaml:"apikey"`
				Model    string `yaml:"model"`
			} `yaml:"openai"`
			Qwen             struct {
				Endpoint string `yaml:"endpoint"`
				APIKey   string `yaml:"apikey"`
				Model    string `yaml:"model"`
			} `yaml:"qwen"`
			DeepSeek struct {
				Endpoint string `yaml:"endpoint"`
				APIKey   string `yaml:"apikey"`
				Model    string `yaml:"model"`
			} `yaml:"deepseek"`
			Kimi struct {
				Endpoint string `yaml:"endpoint"`
				APIKey   string `yaml:"apikey"`
				Model    string `yaml:"model"`
			} `yaml:"kimi"`
			Doubao struct {
				Endpoint string `yaml:"endpoint"`
				APIKey   string `yaml:"apikey"`
				Model    string `yaml:"model"`
			} `yaml:"doubao"`
		} `yaml:"llm"`
		Wechat struct {
			AppID       string `yaml:"app_id"`
			AppSecret   string `yaml:"app_secret"`
			RedirectURI string `yaml:"redirect_uri"`
		} `yaml:"wechat"`
		Knowledge struct {
			QueueMode            string `yaml:"queue_mode"`
			QueueStream          string `yaml:"queue_stream"`
			QueueGroup           string `yaml:"queue_group"`
			QueueBlockMS         int    `yaml:"queue_block_ms"`
			QueueClaimIdleMS     int    `yaml:"queue_claim_idle_ms"`
			QueueClaimEnabled    *bool  `yaml:"queue_claim_enabled"`
			QueueClaimCount      int    `yaml:"queue_claim_count"`
			QueueClaimIntervalMS int    `yaml:"queue_claim_interval_ms"`
			TaskMaxAttempts      int    `yaml:"task_max_attempts"`
			TaskRetryDelayMS     int    `yaml:"task_retry_delay_ms"`
			TaskRetryBackoffMode string `yaml:"task_retry_backoff_mode"`
			TaskRetryMaxDelayMS  int    `yaml:"task_retry_max_delay_ms"`
			TaskLockTTLMS        int    `yaml:"task_lock_ttl_ms"`
			AckRetryCount        int    `yaml:"ack_retry_count"`
			AckRetryIntervalMS   int    `yaml:"ack_retry_interval_ms"`
		} `yaml:"knowledge"`
	}
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		return Config{}, err
	}

	normalized := Config{
		Server: ServerConfig{
			Port:    parsed.Server.Port,
			BaseURL: parsed.Server.BaseURL,
		},
		Database: DatabaseConfig{
			DSN:      parsed.Database.DSN,
			Host:     parsed.Database.Host,
			Port:     parsed.Database.Port,
			Name:     parsed.Database.Name,
			User:     parsed.Database.User,
			Password: parsed.Database.Password,
			SSLMode:  parsed.Database.SSLMode,
		},
		Redis: RedisConfig{
			Addr:     parsed.Redis.Addr,
			Password: parsed.Redis.Password,
			DB:       parsed.Redis.DB,
		},
		SMTP: SMTPConfig{
			Host: parsed.SMTP.Host,
			Port: parsed.SMTP.Port,
			User: parsed.SMTP.User,
			Pass: parsed.SMTP.Pass,
			TLS:  parsed.SMTP.TLS,
			From: parsed.SMTP.From,
		},
		Memory: MemoryConfig{
			QdrantURL:         parsed.Memory.QdrantURL,
			QdrantAPIKey:      parsed.Memory.QdrantAPIKey,
			Collection:        normalizeQuotes(parsed.Memory.Collection),
			EmbeddingProvider: parsed.Memory.EmbeddingProvider,
			EmbeddingModel:    parsed.Memory.EmbeddingModel,
			TopK:              parsed.Memory.TopK,
			EnableFallback:    parsed.Memory.EnableFallback,
		},
		LLM: LLMConfig{
			Provider:         parsed.LLM.Provider,
			AMapAPIKey:       parsed.LLM.AMapAPIKey,
			EnableFallback:   parsed.LLM.EnableFallback,
			RequestTimeoutMS: parsed.LLM.RequestTimeoutMS,
			RetryCount:       parsed.LLM.RetryCount,
			RetryBackoffMS:   parsed.LLM.RetryBackoffMS,
			OpenAI: ProviderConfig{
				Endpoint: parsed.LLM.OpenAI.Endpoint,
				APIKey:   parsed.LLM.OpenAI.APIKey,
				Model:    parsed.LLM.OpenAI.Model,
			},
			Qwen: ProviderConfig{
				Endpoint: parsed.LLM.Qwen.Endpoint,
				APIKey:   parsed.LLM.Qwen.APIKey,
				Model:    parsed.LLM.Qwen.Model,
			},
			DeepSeek: ProviderConfig{
				Endpoint: parsed.LLM.DeepSeek.Endpoint,
				APIKey:   parsed.LLM.DeepSeek.APIKey,
				Model:    parsed.LLM.DeepSeek.Model,
			},
			Kimi: ProviderConfig{
				Endpoint: parsed.LLM.Kimi.Endpoint,
				APIKey:   parsed.LLM.Kimi.APIKey,
				Model:    parsed.LLM.Kimi.Model,
			},
			Doubao: ProviderConfig{
				Endpoint: parsed.LLM.Doubao.Endpoint,
				APIKey:   parsed.LLM.Doubao.APIKey,
				Model:    parsed.LLM.Doubao.Model,
			},
		},
		Wechat: WechatConfig{
			AppID:       parsed.Wechat.AppID,
			AppSecret:   parsed.Wechat.AppSecret,
			RedirectURI: parsed.Wechat.RedirectURI,
		},
		Knowledge: KnowledgeConfig{
			QueueMode:            parsed.Knowledge.QueueMode,
			QueueStream:          parsed.Knowledge.QueueStream,
			QueueGroup:           parsed.Knowledge.QueueGroup,
			QueueBlockMS:         parsed.Knowledge.QueueBlockMS,
			QueueClaimIdleMS:     parsed.Knowledge.QueueClaimIdleMS,
			QueueClaimEnabled:    parsed.Knowledge.QueueClaimEnabled,
			QueueClaimCount:      parsed.Knowledge.QueueClaimCount,
			QueueClaimIntervalMS: parsed.Knowledge.QueueClaimIntervalMS,
			TaskMaxAttempts:      parsed.Knowledge.TaskMaxAttempts,
			TaskRetryDelayMS:     parsed.Knowledge.TaskRetryDelayMS,
			TaskRetryBackoffMode: parsed.Knowledge.TaskRetryBackoffMode,
			TaskRetryMaxDelayMS:  parsed.Knowledge.TaskRetryMaxDelayMS,
			TaskLockTTLMS:        parsed.Knowledge.TaskLockTTLMS,
			AckRetryCount:        parsed.Knowledge.AckRetryCount,
			AckRetryIntervalMS:   parsed.Knowledge.AckRetryIntervalMS,
		},
	}

	return normalized, nil
}

func normalizeQuotes(value string) string {
	trimmed := strings.TrimSpace(value)
	trimmed = strings.Trim(trimmed, "\"")
	trimmed = strings.Trim(trimmed, "'")
	trimmed = strings.ReplaceAll(trimmed, "“", "")
	trimmed = strings.ReplaceAll(trimmed, "”", "")
	return trimmed
}

func boolPtr(value bool) *bool {
	v := value
	return &v
}

func resolveBool(envName string, fileValue *bool, defaultValue bool) bool {
	value := defaultValue
	if fileValue != nil {
		value = *fileValue
	}
	if raw := strings.ToLower(strings.TrimSpace(os.Getenv(envName))); raw != "" {
		switch raw {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return value
}

func resolveInt(envName string, fileValue int, defaultValue int) int {
	value := defaultValue
	if fileValue != 0 {
		value = fileValue
	}
	if raw := strings.TrimSpace(os.Getenv(envName)); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil {
			return parsed
		}
	}
	return value
}
