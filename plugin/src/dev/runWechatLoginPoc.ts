import { FetchHttpClient } from "../services/api-client/httpClient";
import { AuthClient } from "../services/auth/authClient";
import { runWechatLoginFlow } from "../services/auth/loginFlow";
import { PersistentSessionStore } from "../services/auth/sessionStore";
import { MemoryKeyValueStore } from "../storage/keyValueStore";

async function main(): Promise<void> {
  const channel = process.env.LCEDA_PLUGIN_CHANNEL === "professional" ? "professional" : "standard";
  const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:18088";
  const wechatCode = process.env.WECHAT_CODE ?? "mock_code_001";
  const store = new PersistentSessionStore(new MemoryKeyValueStore());
  const client = new AuthClient(new FetchHttpClient(baseUrl));

  const result = await runWechatLoginFlow(client, store, channel, wechatCode);
  console.log("wechat login summary", result.summary);
  console.log("login session", result.loginSessionId);
  console.log("user email", result.userEmail);
  console.log("saved session", await store.get());
}

void main();
