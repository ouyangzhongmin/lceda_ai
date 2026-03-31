export interface KeyValueStore {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  async getItem(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }
}

declare global {
  interface Window {
    localStorage?: Storage;
  }
}

export class LocalStorageKeyValueStore implements KeyValueStore {
  async getItem(key: string): Promise<string | undefined> {
    const storage = resolveLocalStorage();
    if (!storage) {
      return undefined;
    }

    const value = storage.getItem(key);
    return value === null ? undefined : value;
  }

  async setItem(key: string, value: string): Promise<void> {
    const storage = resolveLocalStorage();
    if (!storage) {
      throw new Error("localStorage is not available");
    }

    storage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    const storage = resolveLocalStorage();
    if (!storage) {
      return;
    }

    storage.removeItem(key);
  }
}

function resolveLocalStorage(): Storage | undefined {
  if (typeof globalThis === "undefined") {
    return undefined;
  }

  const candidate = globalThis as typeof globalThis & { localStorage?: Storage };
  return candidate.localStorage;
}
