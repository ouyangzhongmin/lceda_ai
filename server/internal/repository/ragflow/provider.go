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
    cfg        ProviderConfig
    httpClient *http.Client
}

func NewProvider(cfg ProviderConfig) *Provider {
    if cfg.EndpointTemplate == "" {
        cfg.EndpointTemplate = "/api/v1/datasets/{dataset_id}/search"
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
        "query": query.QueryText,
        "top_k": query.TopK,
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
                ID      any     `json:"id"`
                Score   float64 `json:"score"`
                Title   string  `json:"title"`
                Content string  `json:"content"`
                Metadata struct {
                    SourceRef string `json:"source_ref"`
                    KBType    string `json:"kb_type"`
                } `json:"metadata"`
            } `json:"results"`
        } `json:"data"`
    }
    if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
        return nil, err
    }

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
