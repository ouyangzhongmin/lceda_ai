import { FetchHttpClient } from "../services/api-client/httpClient";
import { AuthClient } from "../services/auth/authClient";
import { HostBrowserLauncher } from "../services/auth/browserLauncher";
import { exchangeCompletedLogin, waitLoginSuccess } from "../services/auth/loginPolling";
import { PersistentSessionStore } from "../services/auth/sessionStore";
import { MemoryKeyValueStore } from "../storage/keyValueStore";
import { installFakeHostBridge } from "./installFakeHostBridge";

async function main(): Promise<void> {
  const channel = process.env.LCEDA_PLUGIN_CHANNEL === "professional" ? "professional" : "standard";
  const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:18082";
  const storage = new MemoryKeyValueStore();
  const sessionStore = new PersistentSessionStore(storage);
  installFakeHostBridge(channel);

  const authClient = new AuthClient(new FetchHttpClient(baseUrl));
  const browserLauncher = new HostBrowserLauncher();

  const createSession = await authClient.createLoginSession(channel);
  console.log("browser login session created", createSession);

  await browserLauncher.open(createSession.login_url);
  console.log("browser launch requested");
  console.log(
    "manual next step: complete login with email verify api or browser page, then rerun polling-specific flow"
  );

  const sendCode = await authClient.sendEmailCode(createSession.login_session_id, "demo@example.com");
  console.log("send code", sendCode);

  await authClient.verifyEmailCode(createSession.login_session_id, "demo@example.com", "123456");

  const finalStatus = await waitLoginSuccess(authClient, createSession, {
    timeoutMs: 15_000,
    waitIntervalMs: 500,
  });
  const session = await exchangeCompletedLogin(authClient, createSession, finalStatus);
  await sessionStore.set(session);

  console.log("browser login flow completed", {
    loginSessionId: createSession.login_session_id,
    status: finalStatus.status,
    expiresAt: session.expiresAt,
  });
  console.log("restored session", await sessionStore.get());
}

void main();
