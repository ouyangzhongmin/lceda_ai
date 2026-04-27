package app

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigReadsRAGFlowFromYAML(t *testing.T) {
	t.Setenv("APP_CONFIG", filepath.Join("..", "..", "configs", "config.yaml"))
	t.Setenv("RAGFLOW_BASE_URL", "")
	t.Setenv("RAGFLOW_API_KEY", "")
	t.Setenv("RAGFLOW_DATASET_ID", "")
	t.Setenv("RAGFLOW_ENDPOINT_TEMPLATE", "")
	t.Setenv("RAGFLOW_ENABLED", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig error: %v", err)
	}

	if cfg.RAGFlow.Enabled == nil || !*cfg.RAGFlow.Enabled {
		t.Fatalf("expected ragflow enabled from yaml, got %#v", cfg.RAGFlow.Enabled)
	}
	if cfg.RAGFlow.BaseURL != "http://127.0.0.1:39380" {
		t.Fatalf("unexpected ragflow base url: %q", cfg.RAGFlow.BaseURL)
	}
	if cfg.RAGFlow.APIKey == "" {
		t.Fatal("expected ragflow api key from yaml")
	}
	if cfg.RAGFlow.DatasetID != "6bd834b4342911f185870d318ee3a4a1" {
		t.Fatalf("unexpected ragflow dataset id: %q", cfg.RAGFlow.DatasetID)
	}
	if cfg.RAGFlow.EndpointTemplate != "/api/v1/retrieval" {
		t.Fatalf("unexpected ragflow endpoint template: %q", cfg.RAGFlow.EndpointTemplate)
	}
}
