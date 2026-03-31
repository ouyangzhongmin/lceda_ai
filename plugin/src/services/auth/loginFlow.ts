import type { PluginChannel } from "../../types/schematic";
import { AuthClient, toAuthSession } from "./authClient";
import type { SessionStore } from "./sessionStore";

export interface LoginFlowResult {
  summary: string;
  loginSessionId: string;
  userEmail: string;
  accessToken: string;
}

export async function runEmailLoginFlow(
  authClient: AuthClient,
  sessionStore: SessionStore,
  channel: PluginChannel,
  email: string,
  code: string
): Promise<LoginFlowResult> {
  const loginSession = await authClient.createLoginSession(channel);
  await authClient.getLoginSession(loginSession.login_session_id, loginSession.poll_token);
  await authClient.sendEmailCode(loginSession.login_session_id, email);
  await authClient.verifyEmailCode(loginSession.login_session_id, email, code);
  const completed = await authClient.getLoginSession(
    loginSession.login_session_id,
    loginSession.poll_token
  );

  if (!completed.exchange_token) {
    throw new Error("exchange token missing after email verification");
  }

  const tokenData = await authClient.exchangeToken(
    loginSession.login_session_id,
    completed.exchange_token
  );
  await sessionStore.set(toAuthSession(tokenData));

  return {
    summary: "plugin auth flow completed",
    loginSessionId: loginSession.login_session_id,
    userEmail: tokenData.user.email,
    accessToken: tokenData.access_token,
  };
}

export async function runWechatLoginFlow(
  authClient: AuthClient,
  sessionStore: SessionStore,
  channel: PluginChannel,
  wechatCode: string
): Promise<LoginFlowResult> {
  const loginSession = await authClient.createLoginSession(channel);
  const wechatLogin = await authClient.getWechatLoginUrl(loginSession.login_session_id);
  if (typeof console !== "undefined") {
    console.log("wechat authorize url", wechatLogin.authorize_url);
  }

  await authClient.completeWechatCallback(wechatLogin.state, wechatCode);

  const completed = await authClient.getLoginSession(
    loginSession.login_session_id,
    loginSession.poll_token
  );
  if (!completed.exchange_token) {
    throw new Error("exchange token missing after wechat login");
  }

  const tokenData = await authClient.exchangeToken(
    loginSession.login_session_id,
    completed.exchange_token
  );
  await sessionStore.set(toAuthSession(tokenData));

  return {
    summary: "plugin wechat auth flow completed",
    loginSessionId: loginSession.login_session_id,
    userEmail: tokenData.user.email,
    accessToken: tokenData.access_token,
  };
}
