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
		return domainllm.CompletionResult{}, errors.New("model没有配置")
	}

	reqBody := map[string]any{
		"model":    model,
		"messages": mapMessages(req.Messages),
		"tools":    req.Tools,
		"tool_choice": req.ToolChoice,
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
				Content          string      `json:"content"`
				ReasoningContent string      `json:"reasoning_content"`
				ToolCalls        interface{} `json:"tool_calls"`
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
		OutputText:       firstNonEmpty(decoded.Choices[0].Message.Content, decoded.Choices[0].Message.ReasoningContent),
		ToolCalls:        decoded.Choices[0].Message.ToolCalls,
		PromptTokens:     decoded.Usage.PromptTokens,
		CompletionTokens: decoded.Usage.CompletionTokens,
	}, nil
}

func (p *OpenAICompatibleProvider) StreamGenerate(
	req domainllm.GenerateRequest,
	onDelta func(text string),
	onReasoningDelta func(text string),
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
		"tools":    req.Tools,
		"tool_choice": req.ToolChoice,
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
	var reasoningText strings.Builder
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
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
					ToolCalls        interface{} `json:"tool_calls"`
				} `json:"delta"`
				Message struct {
					ToolCalls interface{} `json:"tool_calls"`
				} `json:"message"`
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
			reasoningDelta := chunk.Choices[0].Delta.ReasoningContent
			if reasoningDelta != "" {
				reasoningText.WriteString(reasoningDelta)
				if onReasoningDelta != nil {
					onReasoningDelta(reasoningDelta)
				}
			}
			delta := chunk.Choices[0].Delta.Content
			if delta != "" {
				fullText.WriteString(delta)
				if onDelta != nil {
					onDelta(delta)
				}
			}
			if chunk.Choices[0].Delta.ToolCalls != nil {
				result.ToolCalls = mergeToolCalls(result.ToolCalls, chunk.Choices[0].Delta.ToolCalls)
			} else if chunk.Choices[0].Message.ToolCalls != nil {
				result.ToolCalls = mergeToolCalls(result.ToolCalls, chunk.Choices[0].Message.ToolCalls)
			}
		}
		if chunk.Usage.PromptTokens > 0 {
			result.PromptTokens = chunk.Usage.PromptTokens
		}
		if chunk.Usage.CompletionTokens > 0 {
			result.CompletionTokens = chunk.Usage.CompletionTokens
		}
	}
	result.OutputText = firstNonEmpty(fullText.String(), reasoningText.String())
	return result, nil
}

func mergeToolCalls(current interface{}, incoming interface{}) interface{} {
	var currentItems []map[string]interface{}
	if current != nil {
		raw, err := json.Marshal(current)
		if err == nil {
			_ = json.Unmarshal(raw, &currentItems)
		}
	}

	var incomingItems []map[string]interface{}
	if incoming != nil {
		raw, err := json.Marshal(incoming)
		if err == nil {
			_ = json.Unmarshal(raw, &incomingItems)
		}
	}
	if len(incomingItems) == 0 {
		return current
	}

	if len(currentItems) == 0 {
		currentItems = []map[string]interface{}{}
	}

	for i, item := range incomingItems {
		target := i
		if idx, ok := item["index"].(float64); ok {
			target = int(idx)
		}
		for len(currentItems) <= target {
			currentItems = append(currentItems, map[string]interface{}{})
		}
		prev := currentItems[target]
		merged := map[string]interface{}{}
		if v, ok := prev["id"]; ok {
			merged["id"] = v
		}
		if v, ok := prev["type"]; ok {
			merged["type"] = v
		}
		if v, ok := prev["function"].(map[string]interface{}); ok {
			merged["function"] = map[string]interface{}{
				"name":      v["name"],
				"arguments": v["arguments"],
			}
		} else {
			merged["function"] = map[string]interface{}{}
		}
		if v, ok := item["id"]; ok {
			merged["id"] = v
		}
		if v, ok := item["type"]; ok {
			merged["type"] = v
		}
		functionValue, _ := merged["function"].(map[string]interface{})
		if functionValue == nil {
			functionValue = map[string]interface{}{}
		}
		if fn, ok := item["function"].(map[string]interface{}); ok {
			if name, ok := fn["name"].(string); ok && name != "" {
				functionValue["name"] = name
			}
			if args, ok := fn["arguments"].(string); ok {
				prevArgs, _ := functionValue["arguments"].(string)
				functionValue["arguments"] = prevArgs + args
			}
		}
		merged["function"] = functionValue
		currentItems[target] = merged
	}

	out := make([]map[string]interface{}, 0, len(currentItems))
	for _, item := range currentItems {
		delete(item, "index")
		out = append(out, item)
	}
	return out
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
			// Include provider error payload (best-effort, clipped) so callers can debug 4xx failures.
			payload, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			detail := strings.TrimSpace(string(payload))
			if detail != "" {
				lastErr = errors.New("llm request failed: " + resp.Status + " " + detail)
			} else {
				lastErr = errors.New("llm request failed: " + resp.Status)
			}
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
			if text, ok := req.Messages[i].Content.(string); ok {
				userPrompt = text
			}
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
	_ func(text string),
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
	onReasoningDelta func(text string),
) (domainllm.CompletionResult, error) {
	if p.primary != nil {
		response, err := p.primary.StreamGenerate(req, onDelta, onReasoningDelta)
		if err == nil {
			return response, nil
		}
	}

	if p.fallback != nil {
		return p.fallback.StreamGenerate(req, onDelta, onReasoningDelta)
	}

	return domainllm.CompletionResult{}, errors.New("no available llm provider")
}

func mapMessages(messages []domainllm.Message) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(messages))
	for _, message := range messages {
		payload := map[string]interface{}{
			"role": message.Role,
		}
		if message.Content != nil {
			payload["content"] = message.Content
		}
		if message.ToolCalls != nil {
			payload["tool_calls"] = message.ToolCalls
		}
		if message.ToolCallID != "" {
			payload["tool_call_id"] = message.ToolCallID
		}
		out = append(out, payload)
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
