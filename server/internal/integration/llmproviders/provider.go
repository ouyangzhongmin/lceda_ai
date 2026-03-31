package llmproviders

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	domainllm "lceda_ai/server/internal/domain/llm"
)

type Provider = domainllm.Provider

type OpenAICompatibleProvider struct {
	name         string
	endpoint     string
	apiKey       string
	defaultModel string
	httpClient   *http.Client
	retryCount   int
	retryBackoff time.Duration
}

func NewOpenAICompatibleProvider(name string, endpoint string, apiKey string, defaultModel string) *OpenAICompatibleProvider {
	return NewOpenAICompatibleProviderWithOptions(name, endpoint, apiKey, defaultModel, 25*time.Second, 1, 300*time.Millisecond)
}

func NewOpenAICompatibleProviderWithOptions(
	name string,
	endpoint string,
	apiKey string,
	defaultModel string,
	timeout time.Duration,
	retryCount int,
	retryBackoff time.Duration,
) *OpenAICompatibleProvider {
	if timeout <= 0 {
		timeout = 25 * time.Second
	}
	if retryCount < 0 {
		retryCount = 0
	}
	if retryBackoff <= 0 {
		retryBackoff = 300 * time.Millisecond
	}
	return &OpenAICompatibleProvider{
		name:         name,
		endpoint:     strings.TrimRight(endpoint, "/"),
		apiKey:       apiKey,
		defaultModel: defaultModel,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		retryCount:   retryCount,
		retryBackoff: retryBackoff,
	}
}

func (p *OpenAICompatibleProvider) Name() string {
	return p.name
}

func (p *OpenAICompatibleProvider) Generate(req domainllm.GenerateRequest) (domainllm.CompletionResult, error) {
	if p.endpoint == "" {
		return domainllm.CompletionResult{}, errors.New("llm endpoint is empty")
	}
	if p.apiKey == "" {
		return domainllm.CompletionResult{}, errors.New("llm api key is empty")
	}

	model := req.Model
	if model == "" {
		model = p.defaultModel
	}
	if model == "" {
		model = "default-model"
	}

	reqBody := map[string]any{
		"model":    model,
		"messages": mapMessages(req.Messages),
		"stream":   false,
	}
	body, _ := json.Marshal(reqBody)

	resp, err := p.doWithRetry(http.MethodPost, p.endpoint+"/chat/completions", body)
	if err != nil {
		return domainllm.CompletionResult{}, err
	}
	defer resp.Body.Close()

	var decoded struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return domainllm.CompletionResult{}, err
	}
	if len(decoded.Choices) == 0 {
		return domainllm.CompletionResult{}, errors.New("llm response is empty")
	}

	return domainllm.CompletionResult{
		Model:            firstNonEmpty(decoded.Model, model),
		OutputText:       decoded.Choices[0].Message.Content,
		PromptTokens:     decoded.Usage.PromptTokens,
		CompletionTokens: decoded.Usage.CompletionTokens,
	}, nil
}

func (p *OpenAICompatibleProvider) StreamGenerate(
	req domainllm.GenerateRequest,
	onDelta func(text string),
) (domainllm.CompletionResult, error) {
	if p.endpoint == "" {
		return domainllm.CompletionResult{}, errors.New("llm endpoint is empty")
	}
	if p.apiKey == "" {
		return domainllm.CompletionResult{}, errors.New("llm api key is empty")
	}

	model := req.Model
	if model == "" {
		model = p.defaultModel
	}
	if model == "" {
		model = "default-model"
	}

	reqBody := map[string]any{
		"model":    model,
		"messages": mapMessages(req.Messages),
		"stream":   true,
	}
	body, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequest(http.MethodPost, p.endpoint+"/chat/completions", bytes.NewBuffer(body))
	if err != nil {
		return domainllm.CompletionResult{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return domainllm.CompletionResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		payload, _ := io.ReadAll(resp.Body)
		return domainllm.CompletionResult{}, errors.New("llm request failed: " + resp.Status + " " + strings.TrimSpace(string(payload)))
	}

	reader := bufio.NewReader(resp.Body)
	var fullText strings.Builder
	result := domainllm.CompletionResult{Model: model}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return domainllm.CompletionResult{}, err
		}
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			break
		}
		var chunk struct {
			Model   string `json:"model"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			continue
		}
		if chunk.Model != "" {
			result.Model = chunk.Model
		}
		if len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta.Content
			if delta != "" {
				fullText.WriteString(delta)
				if onDelta != nil {
					onDelta(delta)
				}
			}
		}
		if chunk.Usage.PromptTokens > 0 {
			result.PromptTokens = chunk.Usage.PromptTokens
		}
		if chunk.Usage.CompletionTokens > 0 {
			result.CompletionTokens = chunk.Usage.CompletionTokens
		}
	}
	result.OutputText = fullText.String()
	return result, nil
}

func (p *OpenAICompatibleProvider) doWithRetry(method string, url string, body []byte) (*http.Response, error) {
	var lastErr error
	for attempt := 0; attempt <= p.retryCount; attempt++ {
		httpReq, err := http.NewRequest(method, url, bytes.NewBuffer(body))
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
		resp, err := p.httpClient.Do(httpReq)
		if err == nil && resp.StatusCode < 300 {
			return resp, nil
		}
		if err == nil && resp != nil {
			_ = resp.Body.Close()
			lastErr = errors.New("llm request failed: " + resp.Status)
		} else {
			lastErr = err
		}
		if attempt < p.retryCount {
			time.Sleep(p.retryBackoff * time.Duration(attempt+1))
		}
	}
	return nil, lastErr
}

type DemoProvider struct{}

func NewDemoProvider() *DemoProvider {
	return &DemoProvider{}
}

func (p *DemoProvider) Name() string {
	return "demo"
}

func (p *DemoProvider) Generate(req domainllm.GenerateRequest) (domainllm.CompletionResult, error) {
	model := req.Model
	if model == "" {
		model = "openai"
	}

	userPrompt := ""
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if req.Messages[i].Role == "user" {
			userPrompt = req.Messages[i].Content
			break
		}
	}

	return domainllm.CompletionResult{
		Model:            model,
		OutputText:       "PoC response: analyzed request and generated a structured placeholder answer for `" + userPrompt + "`.",
		PromptTokens:     128,
		CompletionTokens: 64,
	}, nil
}

func (p *DemoProvider) StreamGenerate(
	req domainllm.GenerateRequest,
	onDelta func(text string),
) (domainllm.CompletionResult, error) {
	result, err := p.Generate(req)
	if err != nil {
		return domainllm.CompletionResult{}, err
	}
	for _, chunk := range chunkString(result.OutputText, 16) {
		if onDelta != nil {
			onDelta(chunk)
		}
	}
	return result, nil
}

type FallbackProvider struct {
	primary  Provider
	fallback Provider
}

func NewFallbackProvider(primary Provider, fallback Provider) *FallbackProvider {
	return &FallbackProvider{
		primary:  primary,
		fallback: fallback,
	}
}

func (p *FallbackProvider) Name() string {
	if p.primary == nil && p.fallback == nil {
		return "none"
	}
	if p.primary == nil {
		return "fallback(" + p.fallback.Name() + ")"
	}
	if p.fallback == nil {
		return p.primary.Name()
	}
	return p.primary.Name() + "+fallback(" + p.fallback.Name() + ")"
}

func (p *FallbackProvider) Generate(req domainllm.GenerateRequest) (domainllm.CompletionResult, error) {
	if p.primary != nil {
		response, err := p.primary.Generate(req)
		if err == nil {
			return response, nil
		}
	}

	if p.fallback != nil {
		return p.fallback.Generate(req)
	}

	return domainllm.CompletionResult{}, errors.New("no available llm provider")
}

func (p *FallbackProvider) StreamGenerate(
	req domainllm.GenerateRequest,
	onDelta func(text string),
) (domainllm.CompletionResult, error) {
	if p.primary != nil {
		response, err := p.primary.StreamGenerate(req, onDelta)
		if err == nil {
			return response, nil
		}
	}

	if p.fallback != nil {
		return p.fallback.StreamGenerate(req, onDelta)
	}

	return domainllm.CompletionResult{}, errors.New("no available llm provider")
}

func mapMessages(messages []domainllm.Message) []map[string]string {
	out := make([]map[string]string, 0, len(messages))
	for _, message := range messages {
		out = append(out, map[string]string{
			"role":    message.Role,
			"content": message.Content,
		})
	}
	return out
}

func firstNonEmpty(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func chunkString(input string, size int) []string {
	if size <= 0 || len(input) <= size {
		return []string{input}
	}
	chunks := make([]string, 0, (len(input)+size-1)/size)
	for len(input) > 0 {
		if len(input) <= size {
			chunks = append(chunks, input)
			break
		}
		chunks = append(chunks, input[:size])
		input = input[size:]
	}
	return chunks
}
