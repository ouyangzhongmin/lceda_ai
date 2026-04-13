import { test } from "node:test";
import * as assert from "node:assert/strict";

import { normalizeToolsForOpenAiCompatible } from "../openaiCompatibleClient";
import type { LlmTool } from "../llmProxyClient";

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
