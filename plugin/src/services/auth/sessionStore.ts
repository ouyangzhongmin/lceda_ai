import type { KeyValueStore } from "../../storage/keyValueStore";
import type { UserProfile } from "./authClient";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user?: UserProfile;
}

export interface SessionStore {
  get(): Promise<AuthSession | undefined>;
  set(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
}

export class PersistentSessionStore implements SessionStore {
  constructor(
    private readonly storage: KeyValueStore,
    private readonly storageKey = "lceda_ai.auth.session"
  ) {}

  async set(session: AuthSession): Promise<void> {
    await this.storage.setItem(this.storageKey, JSON.stringify(session));
  }

  async get(): Promise<AuthSession | undefined> {
    const raw = await this.storage.getItem(this.storageKey);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      typeof parsed.accessToken !== "string" ||
      parsed.accessToken.trim() === "" ||
      typeof parsed.refreshToken !== "string" ||
      parsed.refreshToken.trim() === "" ||
      typeof parsed.expiresAt !== "string" ||
      parsed.expiresAt.trim() === ""
    ) {
      return undefined;
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      user: parsed.user as UserProfile | undefined,
    };
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.storageKey);
  }
}
