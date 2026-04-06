import type { AgentTool } from "./toolRegistry";
import type { RagClient } from "../../services/rag/ragClient";
import type { LlmProxyClient } from "../../services/llm/llmProxyClient";
import type { SessionStore } from "../../services/auth/sessionStore";
import type { CustomLlmConfigStore } from "../../services/llm/customLlmConfigStore";
import type { LlmModeStore } from "../../services/llm/llmModeStore";
import type { LlmMessage } from "../../services/llm/llmProxyClient";
import { UnifiedLlmClient, type UnifiedLlmRouteInfo } from "../../services/llm/unifiedLlmClient";

export function createServerTools(
  ragClient: RagClient,
  llmClient: LlmProxyClient,
  sessionStore: SessionStore,
  customLlmConfigStore?: CustomLlmConfigStore,
  llmModeStore?: LlmModeStore,
  onLlmRoute?: (info: UnifiedLlmRouteInfo) => void
): AgentTool[] {
  const unifiedClient =
    customLlmConfigStore && llmModeStore
      ? new UnifiedLlmClient(llmClient, sessionStore, customLlmConfigStore, llmModeStore, onLlmRoute)
      : undefined;
  return [
    {
      name: "rag_search",
      description: "从服务端检索知识证据",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词或问题描述" },
          topK: { type: "integer", minimum: 1, description: "返回结果条数" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input: { query: string; topK?: number }) =>
        ragClient.search(input.query, input.topK ?? 3),
    },
    {
      name: "rag_build_citations",
      description: "从服务端构建标准引用结果",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词或问题描述" },
          topK: { type: "integer", minimum: 1, description: "返回结果条数" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input: { query: string; topK?: number }) =>
        ragClient.buildCitations(input.query, input.topK ?? 3),
    },
    {
      name: "llm_generate",
      description: "生成 AI 回复（可选：服务端代理或自定义 LLM 直连）",
      execute: async (input: {
        provider?: string;
        model?: string;
        stream?: boolean;
        onEvent?: (event: import("../../services/llm/llmProxyClient").LlmStreamEvent) => void;
        tools?: import("../../services/llm/llmProxyClient").LlmTool[];
        tool_choice?: import("../../services/llm/llmProxyClient").LlmToolChoice;
        messages: LlmMessage[];
      }) => {
        if (unifiedClient) {
          return unifiedClient.generate(input);
        }
        const session = await sessionStore.get();
        if (!session) {
          throw new Error("not logged in");
        }
        if (input.stream) {
          let outputText = "";
          let finalEvent: import("../../services/llm/llmProxyClient").LlmStreamEvent | undefined;
          await llmClient.generateStream(
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
            tool_calls: finalEvent?.tool_calls,
            prompt_tokens: finalEvent?.prompt_tokens ?? 0,
            completion_tokens: finalEvent?.completion_tokens ?? 0,
            cost_credits: finalEvent?.cost_credits ?? 0,
            remaining_credits: finalEvent?.remaining_credits ?? 0,
            billing_transaction: finalEvent?.billing_transaction ?? "",
          };
        }
        return llmClient.generate(session.accessToken, {
          provider: input.provider,
          model: input.model,
          messages: input.messages,
          tools: input.tools,
          tool_choice: input.tool_choice,
        });
      },
    },
  ];
}
