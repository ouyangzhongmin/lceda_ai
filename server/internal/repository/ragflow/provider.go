package ragflow

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	qdrantrepo "lceda_ai/server/internal/repository/qdrant"
)

type ProviderConfig struct {
	BaseURL          string
	APIKey           string
	DatasetID        string
	EndpointTemplate string
	TimeoutSeconds   int
}

type Provider struct {
	cfg                           ProviderConfig
	httpClient                    *http.Client
	lastExternalRagTemplateCorpus []map[string]any
}

func NewProvider(cfg ProviderConfig) *Provider {
	if cfg.EndpointTemplate == "" {
		cfg.EndpointTemplate = "/api/v1/retrieval"
	}
	if cfg.TimeoutSeconds <= 0 {
		cfg.TimeoutSeconds = 12
	}
	return &Provider{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: time.Duration(cfg.TimeoutSeconds) * time.Second,
		},
	}
}

func (p *Provider) Search(query qdrantrepo.SearchQuery) ([]qdrantrepo.SearchHit, error) {
	if p == nil {
		return nil, errors.New("ragflow provider is nil")
	}
	if p.cfg.BaseURL == "" || p.cfg.DatasetID == "" {
		return nil, errors.New("ragflow provider missing base_url or dataset_id")
	}
	if query.TopK <= 0 {
		query.TopK = 5
	}

	endpoint := strings.TrimRight(p.cfg.BaseURL, "/") + strings.ReplaceAll(p.cfg.EndpointTemplate, "{dataset_id}", p.cfg.DatasetID)
	reqBody := map[string]any{
		"question":    query.QueryText,
		"dataset_ids": []string{p.cfg.DatasetID},
		"top_k":       query.TopK,
	}
	raw, _ := json.Marshal(reqBody)
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewBuffer(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, errors.New("ragflow search failed: " + resp.Status)
	}

	var decoded struct {
		Data struct {
			Results []struct {
				ID       any     `json:"id"`
				Score    float64 `json:"score"`
				Title    string  `json:"title"`
				Content  string  `json:"content"`
				Metadata struct {
					SourceRef string `json:"source_ref"`
					KBType    string `json:"kb_type"`
				} `json:"metadata"`
			} `json:"results"`
			Chunks []struct {
				ID              any     `json:"id"`
				DocumentID      string  `json:"document_id"`
				DocumentKeyword string  `json:"document_keyword"`
				Content         string  `json:"content"`
				Similarity      float64 `json:"similarity"`
			} `json:"chunks"`
			DocAggs []struct {
				DocName string `json:"doc_name"`
			} `json:"doc_aggs"`
			ExternalRagTemplateCorpus []map[string]any `json:"external_rag_template_corpus"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}

	p.lastExternalRagTemplateCorpus = append([]map[string]any(nil), decoded.Data.ExternalRagTemplateCorpus...)
	if len(decoded.Data.Results) > 0 {
		out := make([]qdrantrepo.SearchHit, 0, len(decoded.Data.Results))
		for _, r := range decoded.Data.Results {
			out = append(out, qdrantrepo.SearchHit{
				ChunkID:   stringifyID(r.ID),
				Score:     r.Score,
				Title:     r.Title,
				Snippet:   r.Content,
				SourceRef: r.Metadata.SourceRef,
				KBType:    r.Metadata.KBType,
			})
		}
		return out, nil
	}

	type chunkMetadata struct {
		sourceRef string
		kbType    string
	}

	metadataByDocKey := map[string]chunkMetadata{}
	for idx, chunk := range decoded.Data.Chunks {
		title := strings.TrimSpace(chunk.DocumentKeyword)
		if title == "" && idx < len(decoded.Data.DocAggs) {
			title = strings.TrimSpace(decoded.Data.DocAggs[idx].DocName)
		}
		sourceRef, kbType := extractChunkMetadata(chunk.Content)
		if sourceRef == "" && kbType == "" {
			continue
		}
		for _, key := range chunkDocKeys(chunk.DocumentID, title) {
			if key != "" {
				metadataByDocKey[key] = chunkMetadata{sourceRef: sourceRef, kbType: kbType}
			}
		}
	}

	out := make([]qdrantrepo.SearchHit, 0, len(decoded.Data.Chunks))
	for idx, chunk := range decoded.Data.Chunks {
		title := strings.TrimSpace(chunk.DocumentKeyword)
		if title == "" && idx < len(decoded.Data.DocAggs) {
			title = strings.TrimSpace(decoded.Data.DocAggs[idx].DocName)
		}
		sourceRef, kbType := extractChunkMetadata(chunk.Content)
		if sourceRef == "" && kbType == "" {
			for _, key := range chunkDocKeys(chunk.DocumentID, title) {
				if metadata, ok := metadataByDocKey[key]; ok {
					sourceRef = metadata.sourceRef
					kbType = metadata.kbType
					break
				}
			}
		}
		if sourceRef == "" || kbType == "" {
			inferredSourceRef, inferredKBType := inferChunkMetadataFromTitle(title)
			if sourceRef == "" {
				sourceRef = inferredSourceRef
			}
			if kbType == "" {
				kbType = inferredKBType
			}
		}

		out = append(out, qdrantrepo.SearchHit{
			ChunkID:   stringifyID(chunk.ID),
			Score:     chunk.Similarity,
			Title:     title,
			Snippet:   chunk.Content,
			SourceRef: sourceRef,
			KBType:    kbType,
		})
	}
	return out, nil
}

func (p *Provider) ExternalRagTemplateCorpus() []map[string]any {
	return append([]map[string]any(nil), p.lastExternalRagTemplateCorpus...)
}

func stringifyID(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return "unknown_id"
	}
}

func extractChunkMetadata(content string) (string, string) {
	const marker = "```json"
	start := strings.Index(content, marker)
	if start < 0 {
		return "", ""
	}
	rest := content[start+len(marker):]
	end := strings.Index(rest, "```")
	if end < 0 {
		return "", ""
	}

	var metadata struct {
		SourceRef string `json:"source_ref"`
		KBType    string `json:"kb_type"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(rest[:end])), &metadata); err != nil {
		return "", ""
	}
	return strings.TrimSpace(metadata.SourceRef), strings.TrimSpace(metadata.KBType)
}

func chunkDocKeys(documentID string, title string) []string {
	keys := make([]string, 0, 2)
	if documentID = strings.TrimSpace(documentID); documentID != "" {
		keys = append(keys, "docid:"+documentID)
	}
	if title = strings.TrimSpace(title); title != "" {
		keys = append(keys, "title:"+title)
	}
	return keys
}

func inferChunkMetadataFromTitle(title string) (string, string) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", ""
	}

	sourceRef := strings.TrimSuffix(title, ".md")
	sourceRef = strings.TrimSpace(sourceRef)

	lower := strings.ToLower(title)
	switch {
	case strings.HasPrefix(lower, "tpl-"),
		strings.HasPrefix(lower, "project_combo_"),
		strings.HasPrefix(lower, "heuristic-"):
		return sourceRef, "template"
	case strings.Contains(lower, "ti.com"),
		strings.Contains(lower, "training.ti.com"),
		strings.Contains(lower, "onsemi.com"),
		strings.Contains(lower, "nxp.com"),
		strings.Contains(lower, "analog.com"),
		strings.Contains(lower, "st.com"),
		strings.Contains(lower, "infineon.com"):
		return sourceRef, "principle"
	case strings.Contains(lower, "oshw"),
		strings.Contains(lower, "lceda_open_source"),
		strings.Contains(lower, "open_source"):
		return sourceRef, "open_source"
	default:
		return sourceRef, ""
	}
}
