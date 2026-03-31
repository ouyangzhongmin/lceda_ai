import type { AgentTool } from "./toolRegistry";
import type { RagClient } from "../../services/rag/ragClient";
import type { LlmProxyClient } from "../../services/llm/llmProxyClient";
import type { SessionStore } from "../../services/auth/sessionStore";

export function createServerTools(
  ragClient: RagClient,
  llmClient: LlmProxyClient,
  sessionStore: SessionStore
): AgentTool[] {
  return [
    {
      name: "rag.search",
      description: "Search knowledge evidence from the Go server",
      execute: async (input: { query: string; topK?: number }) =>
        ragClient.search(input.query, input.topK ?? 3),
    },
    {
      name: "rag.build_citations",
      description: "Build a standard citation package from the Go server",
      execute: async (input: { query: string; topK?: number }) =>
        ragClient.buildCitations(input.query, input.topK ?? 3),
    },
    {
      name: "llm.generate",
      description: "Generate an AI answer from the Go server LLM proxy",
      execute: async (input: {
        provider?: string;
        model?: string;
        stream?: boolean;
        onEvent?: (event: import("../../services/llm/llmProxyClient").LlmStreamEvent) => void;
        messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      }) => {
        const session = await sessionStore.get();
        if (!session) {
          throw new Error("not logged in");
        }

        if (input.stream) {
          let outputText = "";
          let finalEvent:
            | import("../../services/llm/llmProxyClient").LlmStreamEvent
            | undefined;
          await llmClient.generateStream(
            session.accessToken,
            {
              provider: input.provider,
              model: input.model,
              messages: input.messages,
            },
            (event) => {
              if (event.type === "delta") {
                outputText += event.delta ?? "";
              }
              if (event.type === "done") {
                finalEvent = event;
              }
              if (input.onEvent) {
                input.onEvent(event);
              }
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

        return llmClient.generate(session.accessToken, {
          provider: input.provider,
          model: input.model,
          messages: input.messages,
        });
      },
    },
  ];
}
