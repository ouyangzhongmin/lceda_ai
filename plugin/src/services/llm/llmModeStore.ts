import type { KeyValueStore } from "../../storage/keyValueStore";

export type LlmMode = "custom" | "proxy";

export class LlmModeStore {
  constructor(
    private readonly storage: KeyValueStore,
    private readonly storageKey = "lceda_ai.llm.mode"
  ) {}

  async get(): Promise<LlmMode> {
    const raw = await this.storage.getItem(this.storageKey);
    if (raw === "proxy" || raw === "custom") {
      return raw;
    }
    // Default: custom (no login required)
    return "custom";
  }

  async set(mode: LlmMode): Promise<void> {
    await this.storage.setItem(this.storageKey, mode);
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.storageKey);
  }
}

