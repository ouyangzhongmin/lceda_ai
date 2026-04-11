import type { PluginChannel } from "../../types/schematic";
import type { AuthSession } from "./sessionStore";
import { AuthClient, toAuthSession, type LoginSessionData, type LoginSessionStatusData } from "./authClient";
import type { BrowserLauncher } from "./browserLauncher";

export interface StartBrowserLoginOptions {
  channel: PluginChannel;
  waitIntervalMs?: number;
  timeoutMs?: number;
}

export interface BrowserLoginResult {
  loginSession: LoginSessionData;
  finalStatus: LoginSessionStatusData;
  session: AuthSession;
}

export async function startBrowserLoginFlow(
  authClient: AuthClient,
  browserLauncher: BrowserLauncher,
  options: StartBrowserLoginOptions
): Promise<BrowserLoginResult> {
  const loginSession = await authClient.createLoginSession(options.channel);
  await browserLauncher.open(loginSession.login_url);

  const finalStatus = await waitLoginSuccess(authClient, loginSession, {
    waitIntervalMs: options.waitIntervalMs ?? loginSession.interval_seconds * 1000,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  const session = await exchangeCompletedLogin(authClient, loginSession, finalStatus);

  return { loginSession, finalStatus, session };
}

export async function exchangeCompletedLogin(
  authClient: AuthClient,
  loginSession: LoginSessionData,
  finalStatus: LoginSessionStatusData
): Promise<AuthSession> {
  if (!finalStatus.exchange_token) {
    throw new Error("exchange token missing after browser login completed");
  }

  const tokenData = await authClient.exchangeToken(
    loginSession.login_session_id,
    finalStatus.exchange_token
  );

  return toAuthSession(tokenData);
}

export async function waitLoginSuccess(
  authClient: AuthClient,
  loginSession: LoginSessionData,
  options: {
    waitIntervalMs: number;
    timeoutMs: number;
    maxConsecutiveErrors?: number;
  }
): Promise<LoginSessionStatusData> {
  const startedAt = Date.now();
  const maxConsecutiveErrors = Math.max(1, options.maxConsecutiveErrors ?? 3);
  let consecutiveErrors = 0;

  while (Date.now() - startedAt < options.timeoutMs) {
    const waitSeconds = Math.max(1, Math.min(20, Math.floor(options.waitIntervalMs / 1000)));
    let status: LoginSessionStatusData;
    try {
      status = await authClient.getLoginSession(
        loginSession.login_session_id,
        loginSession.poll_token,
        waitSeconds
      );
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw error;
      }
      continue;
    }

    if (status.status === "success") {
      return status;
    }

    if (status.status === "failed" || status.status === "expired" || status.status === "cancelled") {
      throw new Error(`browser login ended with status: ${status.status}`);
    }

    if (waitSeconds <= 0) {
      await delay(options.waitIntervalMs);
    }
  }

  throw new Error("browser login polling timed out");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
