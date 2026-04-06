import { test } from "node:test";
import * as assert from "node:assert/strict";
import { UnifiedLlmClient } from "../unifiedLlmClient";
import type { LlmProxyClient, LlmStreamEvent } from "../llmProxyClient";

test("UnifiedLlmClient custom stream preserves tool_calls from final event", async () => {
  const sessionStore = {
    get: async () => null,
  } as any;

  const customLlmConfigStore = {
    get: async () => ({
      baseUrl: "https://example.com",
      apiKey: "test-key",
      model: "deepseek-reasoner",
    }),
  } as any;

  const llmModeStore = {
    get: async () => "custom" as const,
  } as any;

  const proxyClient = {} as LlmProxyClient;
  const client = new UnifiedLlmClient(proxyClient, sessionStore, customLlmConfigStore, llmModeStore);

  const customClient = (client as any).customClient as {
    generateStream: (
      config: unknown,
      input: unknown,
      onEvent: (event: LlmStreamEvent) => void
    ) => Promise<void>;
  };

  customClient.generateStream = async (_config, _input, onEvent) => {
    onEvent({
      type: "done",
      request_id: "custom",
      model: "deepseek-reasoner",
      output_text: "",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "editor_get_current_context",
            arguments: "{}",
          },
        },
      ],
    });
  };

  const result = await client.generate({
    stream: true,
    messages: [{ role: "user", content: "分析当前原理图有什么问题" }],
    tools: [],
    tool_choice: "auto",
  });

  assert.deepEqual(result.tool_calls, [
    {
      id: "call_1",
      type: "function",
      function: {
        name: "editor_get_current_context",
        arguments: "{}",
      },
    },
  ]);
});
