import type { KeyValueStore } from "../../storage/keyValueStore";

export interface CustomLlmConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class CustomLlmConfigStore {
  constructor(
    private readonly storage: KeyValueStore,
    private readonly storageKey = "lceda_ai.llm.custom_config"
  ) {}

  async get(): Promise<CustomLlmConfig | undefined> {
    const raw = await this.storage.getItem(this.storageKey);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<CustomLlmConfig>;
    if (
      typeof parsed.provider !== "string" ||
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.apiKey !== "string" ||
      typeof parsed.model !== "string"
    ) {
      return undefined;
    }

    return {
      provider: parsed.provider,
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      model: parsed.model,
    };
  }

  async set(config: CustomLlmConfig): Promise<void> {
    await this.storage.setItem(this.storageKey, JSON.stringify(config));
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.storageKey);
  }
}
