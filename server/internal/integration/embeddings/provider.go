package embeddings

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type Provider interface {
	Embed(text string) ([]float64, error)
}

type OpenAICompatibleEmbedder struct {
	endpoint   string
	apiKey     string
	model      string
	httpClient *http.Client
}

func NewOpenAICompatibleEmbedder(endpoint string, apiKey string, model string) *OpenAICompatibleEmbedder {
	return &OpenAICompatibleEmbedder{
		endpoint: strings.TrimRight(endpoint, "/"),
		apiKey:   apiKey,
		model:    model,
		httpClient: &http.Client{
			Timeout: 12 * time.Second,
		},
	}
}

func (e *OpenAICompatibleEmbedder) Embed(text string) ([]float64, error) {
	if e.endpoint == "" {
		return nil, errors.New("embedding endpoint is empty")
	}
	if e.apiKey == "" {
		return nil, errors.New("embedding api key is empty")
	}
	if e.model == "" {
		return nil, errors.New("embedding model is empty")
	}

	reqBody := map[string]any{
		"model": e.model,
		"input": text,
	}
	body, _ := json.Marshal(reqBody)

	req, err := http.NewRequest(http.MethodPost, e.endpoint+"/embeddings", bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+e.apiKey)

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return nil, errors.New("embedding request failed: " + resp.Status)
	}

	var decoded struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}
	if len(decoded.Data) == 0 || len(decoded.Data[0].Embedding) == 0 {
		return nil, errors.New("embedding response is empty")
	}

	return decoded.Data[0].Embedding, nil
}
