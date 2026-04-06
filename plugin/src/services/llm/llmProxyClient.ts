import type { HttpClient } from "../api-client/httpClient";
import type { ApiResponse } from "../api-client/apiResponse";

export interface LlmToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export type LlmMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: LlmToolCall[];
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    // JSON Schema
    parameters?: unknown;
    strict?: boolean;
  };
}

export type LlmToolChoice =
  | "none"
  | "auto"
  | { type: "function"; function: { name: string } };

export interface LlmGenerateResponse {
  request_id: string;
  provider?: string;
  model: string;
  output_text: string;
  tool_calls?: LlmToolCall[];
  prompt_tokens: number;
  completion_tokens: number;
  cost_credits: number;
  remaining_credits: number;
  billing_transaction: string;
}

export interface LlmLogEntry {
  request_id: string;
  user_id: string;
  scene: string;
  billing_mode: string;
  provider: string;
  model: string;
  request_tokens: number;
  response_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: string;
  error_code?: string;
  cost_credits: number;
  response_summary: string;
  created_at: string;
}

export interface LlmLogsResponse {
  logs: LlmLogEntry[];
}

export interface LlmProviderInfo {
  id: string;
  label: string;
  enabled: boolean;
  default_model: string;
  models: string[];
}

export interface LlmProvidersResponse {
  providers: LlmProviderInfo[];
}

export interface LlmStreamEvent {
  type: "start" | "delta" | "reasoning_delta" | "done" | "error";
  request_id?: string;
  model?: string;
  delta?: string;
  reasoning_delta?: string;
  output_text?: string;
  output_reasoning_text?: string;
  tool_calls?: LlmToolCall[];
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_credits?: number;
  remaining_credits?: number;
  billing_transaction?: string;
  error?: string;
 }

export class LlmProxyClient {
  constructor(private readonly httpClient: HttpClient) {}

  async generate(
    accessToken: string,
    input: {
      provider?: string;
      model?: string;
      messages: LlmMessage[];
      tools?: LlmTool[];
      tool_choice?: LlmToolChoice;
    }
  ): Promise<LlmGenerateResponse> {
    const response = await this.httpClient.request<ApiResponse<LlmGenerateResponse>>(
      "/api/v1/llm/generate",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scene: "schematic_analysis",
          billing_mode: "credits",
          provider: input.provider,
          model: input.model,
          messages: input.messages,
          tools: input.tools,
          tool_choice: input.tool_choice,
        }),
      }
    );

    if (response.code !== 0) {
      throw new Error(response.error?.detail ?? response.message);
    }

    return response.data;
  }

  async generateStream(
    accessToken: string,
    input: {
      provider?: string;
      model?: string;
      messages: LlmMessage[];
      tools?: LlmTool[];
      tool_choice?: LlmToolChoice;
    },
    onEvent: (event: LlmStreamEvent) => void
  ): Promise<void> {
    await this.httpClient.openEventStream("/api/v1/llm/generate/stream", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        scene: "schematic_analysis",
        billing_mode: "credits",
        provider: input.provider,
        model: input.model,
        messages: input.messages,
        tools: input.tools,
        tool_choice: input.tool_choice,
      }),
      onEvent: (event) => {
        onEvent(event.data as LlmStreamEvent);
      },
    });
  }

  async listLogs(accessToken: string, limit = 20): Promise<LlmLogsResponse> {
    const response = await this.httpClient.request<ApiResponse<LlmLogsResponse>>(
      `/api/v1/llm/logs?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.code !== 0) {
      throw new Error(response.error?.detail ?? response.message);
    }

    return response.data;
  }

  async listProviders(accessToken: string): Promise<LlmProvidersResponse> {
    const response = await this.httpClient.request<ApiResponse<LlmProvidersResponse>>(
      "/api/v1/llm/providers",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.code !== 0) {
      throw new Error(response.error?.detail ?? response.message);
    }

    return response.data;
  }
}
