const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:18080";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(`${path} failed: ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function main() {
  console.log(`using base url: ${baseUrl}`);

  const loginSession = await request("/api/v1/auth/login-sessions", {
    method: "POST",
    body: JSON.stringify({
      client_type: "lceda_plugin",
      plugin_channel: "standard",
      plugin_version: "0.1.0",
      platform: "darwin",
      login_methods: ["email"],
    }),
  });
  console.log("login session created", loginSession);

  const pending = await request(
    `/api/v1/auth/login-sessions/${loginSession.login_session_id}?poll_token=${loginSession.poll_token}`
  );
  console.log("initial session status", pending);

  const sendCode = await request("/api/v1/auth/email/send-code", {
    method: "POST",
    body: JSON.stringify({
      login_session_id: loginSession.login_session_id,
      email: "demo@example.com",
      scene: "login",
    }),
  });
  console.log("send code", sendCode);

  const verifyCode = await request("/api/v1/auth/email/verify-code", {
    method: "POST",
    body: JSON.stringify({
      login_session_id: loginSession.login_session_id,
      email: "demo@example.com",
      code: "123456",
    }),
  });
  console.log("verify code", verifyCode);

  const completed = await request(
    `/api/v1/auth/login-sessions/${loginSession.login_session_id}?poll_token=${loginSession.poll_token}`
  );
  console.log("completed session status", completed);

  const tokenPair = await request("/api/v1/auth/tokens:action?action=tokens%3Aexchange", {
    method: "POST",
    body: JSON.stringify({
      login_session_id: loginSession.login_session_id,
      exchange_token: completed.exchange_token,
    }),
  });
  console.log("exchanged token", tokenPair);

  const refreshed = await request("/api/v1/auth/tokens:action?action=tokens%3Arefresh", {
    method: "POST",
    body: JSON.stringify({
      refresh_token: tokenPair.refresh_token,
    }),
  });
  console.log("refreshed token", refreshed);

  console.log("login poc completed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
