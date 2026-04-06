import type { SessionStore } from "../auth/sessionStore";
import type { CustomLlmConfigStore } from "./customLlmConfigStore";
import type { LlmModeStore } from "./llmModeStore";
import type { LlmGenerateResponse, LlmMessage, LlmProxyClient, LlmStreamEvent, LlmTool, LlmToolChoice } from "./llmProxyClient";
import { OpenAiCompatibleClient } from "./openaiCompatibleClient";

export interface UnifiedLlmInput {
  provider?: string;
  model?: string;
  stream?: boolean;
  onEvent?: (event: LlmStreamEvent) => void;
  messages: LlmMessage[];
  tools?: LlmTool[];
  tool_choice?: LlmToolChoice;
}

export interface UnifiedLlmRouteInfo {
  route: "custom" | "proxy";
  model: string;
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

function debugLog(label: string, payload: unknown): void {
  if (!isDebugEnabled()) return;
  console.log(`[LCEDA-AI][unified-llm] ${label}`, payload);
}

export class UnifiedLlmClient {
  private readonly customClient = new OpenAiCompatibleClient();

  constructor(
    private readonly llmClient: LlmProxyClient,
    private readonly sessionStore: SessionStore,
    private readonly customLlmConfigStore: CustomLlmConfigStore,
    private readonly llmModeStore: LlmModeStore,
    private readonly onRoute?: (info: UnifiedLlmRouteInfo) => void
  ) {}

  async generate(input: UnifiedLlmInput): Promise<LlmGenerateResponse> {
    const mode = await this.llmModeStore.get();
    if (mode === "custom") {
      const cfg = await this.customLlmConfigStore.get();
      if (!cfg) {
        throw new Error("custom llm not configured: please set baseUrl/apiKey/model in Settings");
      }
      this.onRoute?.({ route: "custom", model: input.model || cfg.model });
      debugLog("route", {
        route: "custom",
        stream: Boolean(input.stream),
        model: input.model || cfg.model,
      });

      if (input.stream) {
        let outputText = "";
        let finalEvent: LlmStreamEvent | undefined;
        await this.customClient.generateStream(
          { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model },
          { model: input.model, messages: input.messages, tools: input.tools, tool_choice: input.tool_choice },
          (event) => {
            if (event.type === "delta") {
              outputText += event.delta ?? "";
            }
            if (event.type === "done" || event.type === "error") {
              finalEvent = event;
            }
            input.onEvent?.(event);
          }
        );
        if (finalEvent?.type === "error") {
          throw new Error(finalEvent.error || "custom stream failed");
        }
        return {
          request_id: finalEvent?.request_id ?? "custom",
          provider: "custom",
          model: finalEvent?.model ?? input.model ?? cfg.model,
          output_text: finalEvent?.output_text ?? outputText,
          tool_calls: finalEvent?.tool_calls,
          prompt_tokens: 0,
          completion_tokens: 0,
          cost_credits: 0,
          remaining_credits: 0,
          billing_transaction: "",
        };
      }

      const res = await this.customClient.generate(
        { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model },
        { model: input.model, messages: input.messages, tools: input.tools, tool_choice: input.tool_choice }
      );
      return {
        request_id: "custom",
        provider: "custom",
        model: res.model,
        output_text: res.output_text,
        tool_calls: Array.isArray(res.tool_calls) ? res.tool_calls : undefined,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_credits: 0,
        remaining_credits: 0,
        billing_transaction: "",
      };
    }

    const session = await this.sessionStore.get();
    if (!session) {
      throw new Error("not logged in");
    }
    this.onRoute?.({ route: "proxy", model: input.model || "" });
    debugLog("route", {
      route: "proxy",
      stream: Boolean(input.stream),
      model: input.model || "",
    });

    if (input.stream) {
      let outputText = "";
      let finalEvent: LlmStreamEvent | undefined;
      await this.llmClient.generateStream(
        session.accessToken,
        {
          provider: input.provider,
          model: input.model,
          messages: input.messages,
          tools: input.tools,
          tool_choice: input.tool_choice,
        },
        (event) => {
          if (event.type === "delta") {
            outputText += event.delta ?? "";
          }
          if (event.type === "done" || event.type === "error") {
            finalEvent = event;
          }
          input.onEvent?.(event);
        }
      );
      if (finalEvent?.type === "error") {
        throw new Error(finalEvent.error || "stream failed");
      }
      return {
        request_id: finalEvent?.request_id ?? "",
        provider: input.provider,
        model: finalEvent?.model ?? input.model ?? "",
        output_text: finalEvent?.output_text ?? outputText,
        prompt_tokens: finalEvent?.prompt_tokens ?? 0,
        completion_tokens: finalEvent?.completion_tokens ?? 0,
        cost_credits: finalEvent?.cost_credits ?? 0,
        remaining_credits: finalEvent?.remaining_credits ?? 0,
        billing_transaction: finalEvent?.billing_transaction ?? "",
      };
    }

    return this.llmClient.generate(session.accessToken, {
      provider: input.provider,
      model: input.model,
      messages: input.messages,
      tools: input.tools,
      tool_choice: input.tool_choice,
    });
  }
}
