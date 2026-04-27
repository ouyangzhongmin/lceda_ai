import { test } from "node:test";
import * as assert from "node:assert/strict";

import { OpenAiCompatibleClient, normalizeToolsForOpenAiCompatible } from "../openaiCompatibleClient";
import type { LlmMessage, LlmTool } from "../llmProxyClient";

test("normalizeToolsForOpenAiCompatible omits strict for custom openai-compatible tools", () => {
  const tools: LlmTool[] = [
    {
      type: "function",
      function: {
        name: "rag_search",
        description: "search",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            topK: { type: "integer" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
  ];

  const normalized = normalizeToolsForOpenAiCompatible(tools);

  assert.equal(normalized[0]?.function.strict, undefined);
  assert.deepEqual((normalized[0]?.function.parameters as any)?.required, ["query"]);
});

test("normalizeToolsForOpenAiCompatible keeps non-strict tool schemas unchanged except strict flag omission", () => {
  const tools: LlmTool[] = [
    {
      type: "function",
      function: {
        name: "library_search_devices",
        description: "search devices",
        strict: false,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            pageSize: { type: "integer" },
          },
          required: ["query"],
          additionalProperties: true,
        },
      },
    },
  ];

  const normalized = normalizeToolsForOpenAiCompatible(tools);
  const expected = [
    {
      ...tools[0],
      function: {
        ...tools[0]!.function,
        strict: undefined,
      },
    },
  ];

  assert.deepEqual(normalized, expected);
});

test("normalizeToolsForOpenAiCompatible preserves optional object properties for custom openai-compatible tools", () => {
  const tools: LlmTool[] = [
    {
      type: "function",
      function: {
        name: "library_search_devices",
        description: "search devices",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            scope: { type: "string" },
          },
          required: ["query"],
          additionalProperties: true,
        },
      },
    },
  ];

  const normalized = normalizeToolsForOpenAiCompatible(tools);
  const parameters = normalized[0]?.function.parameters as any;

  assert.equal(normalized[0]?.function.strict, undefined);
  assert.equal(parameters.additionalProperties, true);
  assert.deepEqual(parameters.required, ["query"]);
});

test("normalizeToolsForOpenAiCompatible preserves nested optional required fields for custom openai-compatible tools", () => {
  const tools: LlmTool[] = [
    {
      type: "function",
      function: {
        name: "todo_list",
        description: "todo",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            action: { type: "string" },
            tasks: {
              type: "array",
              items: {
                anyOf: [
                  { type: "string" },
                  {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      status: { type: "string" },
                    },
                    required: ["text"],
                    additionalProperties: true,
                  },
                ],
              },
            },
          },
          required: ["tasks"],
          additionalProperties: true,
        },
      },
    },
  ];

  const normalized = normalizeToolsForOpenAiCompatible(tools);
  const parameters = normalized[0]?.function.parameters as any;
  const nestedObject = parameters.properties.tasks.items.anyOf[1];

  assert.equal(normalized[0]?.function.strict, undefined);
  assert.deepEqual(parameters.required, ["tasks"]);
  assert.equal(parameters.additionalProperties, true);
  assert.deepEqual(nestedObject.required, ["text"]);
  assert.equal(nestedObject.additionalProperties, true);
});

test("OpenAiCompatibleClient.generate passes assistant reasoning_content back for thinking models", async () => {
  const client = new OpenAiCompatibleClient();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: any }> = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ body: JSON.parse(String(init?.body || "{}")) });
    return new Response(
      JSON.stringify({
        model: "deepseek-v4-flash",
        choices: [
          {
            message: {
              content: "已处理",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  }) as typeof fetch;

  try {
    const messages: LlmMessage[] = [
      { role: "system", content: "你是助手" },
      { role: "user", content: "第一轮问题" },
      { role: "assistant", content: "第一轮回答", reasoning_content: "第一轮思考过程" },
      { role: "user", content: "继续修改" },
    ];

    await client.generate(
      {
        baseUrl: "https://example.com/v1",
        apiKey: "test-key",
        model: "deepseek-v4-flash",
      },
      {
        messages,
      }
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.body?.messages?.[2], {
      role: "assistant",
      content: "第一轮回答",
      reasoning_content: "第一轮思考过程",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAiCompatibleClient.generate degrades assistant history without reasoning_content for deepseek models", async () => {
  const client = new OpenAiCompatibleClient();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: any }> = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ body: JSON.parse(String(init?.body || "{}")) });
    return new Response(
      JSON.stringify({
        model: "deepseek-v4-flash",
        choices: [{ message: { content: "ok" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await client.generate(
      {
        baseUrl: "https://example.com/v1",
        apiKey: "test-key",
        model: "deepseek-v4-flash",
      },
      {
        messages: [
          { role: "system", content: "你是助手" },
          { role: "assistant", content: "上一轮普通回答" },
          { role: "user", content: "继续" },
        ],
      }
    );

    assert.deepEqual(requests[0]?.body?.messages?.[1], {
      role: "user",
      content: "上轮助手回复（供延续上下文，不需要逐字复述）：\n上一轮普通回答",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
