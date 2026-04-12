import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  CustomLlmConfigStore,
  DEFAULT_PREFERRED_OUTPUT_LANGUAGE,
} from "../customLlmConfigStore";

test("CustomLlmConfigStore falls back preferredOutputLanguage to default for legacy config", async () => {
  const backing = new Map<string, string>();
  const store = new CustomLlmConfigStore({
    getItem: async (key: string) => backing.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: async (key: string) => {
      backing.delete(key);
    },
  });

  await backing.set(
    "lceda_ai.llm.custom_config",
    JSON.stringify({
      provider: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "gpt-5.4",
    })
  );

  const config = await store.get();
  assert.equal(config?.preferredOutputLanguage, DEFAULT_PREFERRED_OUTPUT_LANGUAGE);
});
