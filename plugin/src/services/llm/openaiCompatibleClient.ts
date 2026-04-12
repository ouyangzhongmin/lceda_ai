import type { LlmMessage, LlmStreamEvent } from "./llmProxyClient";
import type { LlmTool, LlmToolChoice } from "./llmProxyClient";

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    message?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  model?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
    finish_reason?: string | null;
  }>;
  model?: string;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function isConfigured(cfg: OpenAiCompatibleConfig): boolean {
  return Boolean(cfg.baseUrl && cfg.apiKey && cfg.model);
}

function toHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function isDebugEnabled(): boolean {
  try {
    const globalFlag = (globalThis as typeof globalThis & { LCEDA_DEBUG_LLM?: unknown }).LCEDA_DEBUG_LLM;
    if (globalFlag === true || globalFlag === "1" || globalFlag === 1) return true;
  } catch {
    // ignore
  }
  try {
    if (typeof process !== "undefined" && process?.env?.LCEDA_DEBUG_LLM === "1") return true;
  } catch {
    // ignore
  }
  return false;
}

function clipText(value: unknown, maxLen = 240): string | null {
  if (value === null) return null;
  if (typeof value === "undefined") return null;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
}

function summarizeMessages(messages: LlmMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: message.role,
        content: clipText(message.content),
        tool_calls: (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          type: call.type,
          function: {
            name: call.function?.name,
            argumentsPreview: clipText(call.function?.arguments, 160),
            argumentsLength: String(call.function?.arguments || "").length,
          },
        })),
      };
    }
    if (message.role === "tool") {
      return {
        role: message.role,
        tool_call_id: message.tool_call_id,
        contentPreview: clipText(message.content, 200),
        contentLength: String(message.content || "").length,
      };
    }
    return {
      role: message.role,
      contentPreview: clipText(message.content, 200),
      contentLength: String(message.content || "").length,
    };
  });
}

function summarizeTools(tools?: LlmTool[]): unknown[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((tool) => ({
    type: tool.type,
    name: tool.function.name,
    strict: tool.function.strict,
    hasDescription: Boolean(tool.function.description),
    parameters: tool.function.parameters,
  }));
}

function debugLog(label: string, payload: unknown): void {
  if (!isDebugEnabled()) return;
  console.log(`[LCEDA-AI][custom-llm] ${label}`, payload);
}

function mapMessages(messages: LlmMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === "assistant") {
      return {
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
      };
    }
    if (m.role === "tool") {
      return {
        role: m.role,
        content: m.content,
        tool_call_id: m.tool_call_id,
      };
    }
    return { role: m.role, content: m.content };
  });
}

function mergeToolCalls(
  current: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>,
  incoming: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>
): Array<{
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}> {
  const next = current.slice();
  for (let i = 0; i < incoming.length; i += 1) {
    const chunk = incoming[i];
    const targetIndex = typeof chunk.index === "number" ? chunk.index : i;
    const prev = next[targetIndex] ?? {};
    next[targetIndex] = {
      index: typeof chunk.index === "number" ? chunk.index : prev.index,
      id: chunk.id ?? prev.id,
      type: chunk.type ?? prev.type,
      function: {
        name: chunk.function?.name ?? prev.function?.name,
        arguments: `${prev.function?.arguments ?? ""}${chunk.function?.arguments ?? ""}`,
      },
    };
  }
  return next;
}

export class OpenAiCompatibleClient {
  async generate(
    config: OpenAiCompatibleConfig,
    input: { messages: LlmMessage[]; model?: string; tools?: LlmTool[]; tool_choice?: LlmToolChoice; signal?: AbortSignal }
  ): Promise<{ model: string; output_text: string; tool_calls?: unknown }> {
    const cfg: OpenAiCompatibleConfig = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      model: input.model || config.model,
    };
    if (!isConfigured(cfg)) {
      throw new Error("custom llm not configured: please set baseUrl/apiKey/model in Settings");
    }

    debugLog("request", {
      mode: "custom",
      stream: false,
      url: `${cfg.baseUrl}/chat/completions`,
      model: cfg.model,
      tool_choice: input.tool_choice,
      messages: summarizeMessages(input.messages),
      tools: summarizeTools(input.tools),
    });

    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: toHeaders(cfg.apiKey),
      body: JSON.stringify({
        model: cfg.model,
        messages: mapMessages(input.messages),
        tools: input.tools,
        tool_choice: input.tool_choice,
        stream: false,
      }),
      signal: input.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `custom llm request failed: ${response.status} ${response.statusText}${bodyText ? `; ${bodyText.slice(0, 600)}` : ""}`
      );
    }
    const payload = (bodyText ? safeJsonParse(bodyText) : {}) as ChatCompletionResponse;

    const output = payload?.choices?.[0]?.message?.content ?? "";
    const reasoning = payload?.choices?.[0]?.message?.reasoning_content ?? "";
    const toolCalls = payload?.choices?.[0]?.message?.tool_calls ?? payload?.choices?.[0]?.tool_calls ?? undefined;
    debugLog("response", {
      mode: "custom",
      stream: false,
      model: payload?.model ?? cfg.model,
      outputPreview: clipText(output || reasoning),
      tool_calls: toolCalls,
    });
    // For reasoner models, reasoning may be provided out-of-band. Keep backward compatibility
    // by falling back to reasoning text only when final content is empty.
    return { model: payload?.model ?? cfg.model, output_text: output || reasoning, tool_calls: toolCalls };
  }

  async generateStream(
    config: OpenAiCompatibleConfig,
    input: { messages: LlmMessage[]; model?: string; tools?: LlmTool[]; tool_choice?: LlmToolChoice; signal?: AbortSignal },
    onEvent: (event: LlmStreamEvent) => void
  ): Promise<void> {
    const cfg: OpenAiCompatibleConfig = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      model: input.model || config.model,
    };
    if (!isConfigured(cfg)) {
      onEvent({ type: "error", error: "custom llm not configured: please set baseUrl/apiKey/model in Settings" });
      return;
    }

    onEvent({ type: "start", request_id: "custom", model: cfg.model });
    debugLog("request", {
      mode: "custom",
      stream: true,
      url: `${cfg.baseUrl}/chat/completions`,
      model: cfg.model,
      tool_choice: input.tool_choice,
      messages: summarizeMessages(input.messages),
      tools: summarizeTools(input.tools),
    });

    let outputText = "";
    let reasoningText = "";
    let toolCalls: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }> = [];
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...toHeaders(cfg.apiKey),
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: mapMessages(input.messages),
        tools: input.tools,
        tool_choice: input.tool_choice,
        stream: true,
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      onEvent({
        type: "error",
        error: `custom llm request failed: ${response.status} ${response.statusText}${body ? `; ${body.slice(0, 600)}` : ""}`,
      });
      return;
    }
    if (!response.body) {
      onEvent({ type: "error", error: "custom llm stream response body is empty" });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = parseSseData(rawEvent);
        if (data === null) {
          boundary = buffer.indexOf("\n\n");
          continue;
        }
        if (typeof data === "string") {
          const text = data.trim();
          if (text === "[DONE]") {
            onEvent({ type: "done", request_id: "custom", model: cfg.model, output_text: outputText });
            return;
          }
          boundary = buffer.indexOf("\n\n");
          continue;
        }
        const parsed = data as ChatCompletionChunk;
        const reasoningDelta = parsed?.choices?.[0]?.delta?.reasoning_content;
        if (reasoningDelta) {
          reasoningText += reasoningDelta;
          onEvent({
            type: "reasoning_delta",
            request_id: "custom",
            model: parsed?.model ?? cfg.model,
            reasoning_delta: reasoningDelta,
            output_reasoning_text: reasoningText,
          });
        }
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) {
          outputText += delta;
          onEvent({ type: "delta", request_id: "custom", model: parsed?.model ?? cfg.model, delta });
        }
        const chunkToolCalls = parsed?.choices?.[0]?.delta?.tool_calls ?? parsed?.choices?.[0]?.message?.tool_calls;
        if (Array.isArray(chunkToolCalls) && chunkToolCalls.length > 0) {
          toolCalls = mergeToolCalls(toolCalls, chunkToolCalls);
          debugLog("stream.tool_calls.delta", {
            model: parsed?.model ?? cfg.model,
            chunk_tool_calls: chunkToolCalls,
            merged_tool_calls: toolCalls.map(({ index, ...item }) => item),
          });
        }
        const doneReason = parsed?.choices?.[0]?.finish_reason;
        if (doneReason) {
            debugLog("stream.done", {
              model: parsed?.model ?? cfg.model,
              finish_reason: doneReason,
              outputPreview: clipText(outputText || reasoningText),
              tool_calls: toolCalls.map(({ index, ...item }) => item),
            });
            onEvent({
              type: "done",
              request_id: "custom",
              model: parsed?.model ?? cfg.model,
              output_text: outputText || reasoningText,
              output_reasoning_text: reasoningText,
              tool_calls: toolCalls.map(({ index, ...item }) => item),
            });
            return;
          }
        boundary = buffer.indexOf("\n\n");
      }
    }

    // Some servers terminate without sending [DONE]; treat as done.
    debugLog("stream.done", {
      model: cfg.model,
      finish_reason: "eof",
      outputPreview: clipText(outputText || reasoningText),
      tool_calls: toolCalls.map(({ index, ...item }) => item),
    });
    onEvent({
      type: "done",
      request_id: "custom",
      model: cfg.model,
      output_text: outputText || reasoningText,
      output_reasoning_text: reasoningText,
      tool_calls: toolCalls.map(({ index, ...item }) => item),
    });
  }
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function parseSseData(rawEvent: string): unknown | null {
  const lines = rawEvent.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  return safeJsonParse(raw);
}
