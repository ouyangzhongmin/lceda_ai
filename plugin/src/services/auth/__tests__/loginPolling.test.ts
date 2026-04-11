import { test } from "node:test";
import * as assert from "node:assert/strict";

import { waitLoginSuccess } from "../loginPolling";
import type { AuthClient, LoginSessionData, LoginSessionStatusData } from "../authClient";

const loginSession: LoginSessionData = {
  login_session_id: "session-1",
  poll_token: "poll-token-1",
  login_url: "https://example.com/login",
  expires_at: "2099-01-01T00:00:00.000Z",
  interval_seconds: 1,
};

function buildStatus(status: LoginSessionStatusData["status"], exchangeToken?: string): LoginSessionStatusData {
  return {
    login_session_id: loginSession.login_session_id,
    status,
    exchange_token: exchangeToken,
    expires_at: "2099-01-01T00:00:00.000Z",
  };
}

test("waitLoginSuccess retries after a transient polling error and eventually succeeds", async () => {
  let attempts = 0;
  const authClient = {
    async getLoginSession(): Promise<LoginSessionStatusData> {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary network error");
      }
      return buildStatus("success", "exchange-token-1");
    },
  } as Pick<AuthClient, "getLoginSession"> as AuthClient;

  const status = await waitLoginSuccess(authClient, loginSession, {
    waitIntervalMs: 1,
    timeoutMs: 200,
  });

  assert.equal(status.status, "success");
  assert.equal(status.exchange_token, "exchange-token-1");
  assert.equal(attempts, 2);
});

test("waitLoginSuccess fails after consecutive polling errors exceed the retry budget", async () => {
  let attempts = 0;
  const authClient = {
    async getLoginSession(): Promise<LoginSessionStatusData> {
      attempts += 1;
      throw new Error(`temporary network error ${attempts}`);
    },
  } as Pick<AuthClient, "getLoginSession"> as AuthClient;

  await assert.rejects(
    () =>
      waitLoginSuccess(authClient, loginSession, {
        waitIntervalMs: 1,
        timeoutMs: 200,
      }),
    /temporary network error 3/
  );
  assert.equal(attempts, 3);
});
