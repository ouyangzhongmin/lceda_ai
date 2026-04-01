import type { HttpClient } from "../api-client/httpClient";
import type { ApiResponse } from "../api-client/apiResponse";
import type { PluginChannel } from "../../types/schematic";
import type { AuthSession } from "./sessionStore";

export interface LoginSessionData {
  login_session_id: string;
  poll_token: string;
  login_url: string;
  expires_at: string;
  interval_seconds: number;
}

export interface LoginSessionStatusData {
  login_session_id: string;
  status: "pending" | "success" | "failed" | "expired" | "cancelled";
  exchange_token?: string;
  expires_at: string;
}

export interface EmailCodeResult {
  sent: boolean;
  hint?: string;
}

export interface WechatLoginUrlData {
  provider: "wechat";
  authorize_url: string;
  state: string;
}

export interface WechatBindResult {
  user_id: string;
  wechat_bound: boolean;
}

export interface TokenExchangeData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number; // Refresh Token 有效期（秒）
  user: UserProfile;
}

export interface UserProfile {
  user_id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  wechat_bound: boolean;
  user_type: string;
  created_at: string;
}

export interface LogoutResult {
  logged_out: boolean;
  all_devices: boolean;
}

export class AuthClient {
  constructor(private readonly httpClient: HttpClient) {}

  async createLoginSession(channel: PluginChannel): Promise<LoginSessionData> {
    const response = await this.httpClient.request<ApiResponse<LoginSessionData>>(
      "/api/v1/auth/login-sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_type: "lceda_plugin",
          plugin_channel: channel,
          plugin_version: "0.1.0",
          platform: "darwin",
          login_methods: ["email", "wechat"],
        }),
      }
    );
    return unwrap(response);
  }

  async getLoginSession(
    loginSessionId: string,
    pollToken: string,
    waitSeconds = 0
  ): Promise<LoginSessionStatusData> {
    const safeWait = Number.isFinite(waitSeconds) ? Math.max(0, Math.min(20, Math.floor(waitSeconds))) : 0;
    const response = await this.httpClient.request<ApiResponse<LoginSessionStatusData>>(
      `/api/v1/auth/login-sessions/${loginSessionId}?poll_token=${pollToken}&wait_seconds=${safeWait}`
    );
    return unwrap(response);
  }

  async sendEmailCode(loginSessionId: string, email: string): Promise<EmailCodeResult> {
    const response = await this.httpClient.request<ApiResponse<EmailCodeResult>>(
      "/api/v1/auth/email/send-code",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          login_session_id: loginSessionId,
          email,
          scene: "login",
        }),
      }
    );
    return unwrap(response);
  }

  async verifyEmailCode(
    loginSessionId: string,
    email: string,
    code: string
  ): Promise<LoginSessionStatusData> {
    const response = await this.httpClient.request<ApiResponse<LoginSessionStatusData>>(
      "/api/v1/auth/email/verify-code",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          login_session_id: loginSessionId,
          email,
          code,
        }),
      }
    );
    return unwrap(response);
  }

  async getWechatLoginUrl(loginSessionId: string): Promise<WechatLoginUrlData> {
    const response = await this.httpClient.request<ApiResponse<WechatLoginUrlData>>(
      "/api/v1/auth/wechat/login-url",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          login_session_id: loginSessionId,
        }),
      }
    );
    return unwrap(response);
  }

  async bindWechat(accessToken: string, bindTicket: string): Promise<WechatBindResult> {
    const response = await this.httpClient.request<ApiResponse<WechatBindResult>>(
      "/api/v1/auth/wechat/bind",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bind_ticket: bindTicket,
        }),
      }
    );
    return unwrap(response);
  }

  async completeWechatCallback(state: string, code: string): Promise<void> {
    await this.httpClient.request<ApiResponse<Record<string, unknown>>>(
      `/api/v1/auth/wechat/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`
    );
  }

  async exchangeToken(
    loginSessionId: string,
    exchangeToken: string
  ): Promise<TokenExchangeData> {
    const response = await this.httpClient.request<ApiResponse<TokenExchangeData>>(
      "/api/v1/auth/tokens:action?action=tokens%3Aexchange",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          login_session_id: loginSessionId,
          exchange_token: exchangeToken,
        }),
      }
    );
    return unwrap(response);
  }

  async refreshToken(refreshToken: string): Promise<TokenExchangeData> {
    const response = await this.httpClient.request<ApiResponse<TokenExchangeData>>(
      "/api/v1/auth/tokens:action?action=tokens%3Arefresh",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          refresh_token: refreshToken,
        }),
      }
    );
    return unwrap(response);
  }

  async getCurrentUser(accessToken: string): Promise<UserProfile> {
    const response = await this.httpClient.request<ApiResponse<UserProfile>>("/api/v1/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return unwrap(response);
  }

  async logout(accessToken: string, allDevices = false): Promise<LogoutResult> {
    const response = await this.httpClient.request<ApiResponse<LogoutResult>>("/api/v1/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        all_devices: allDevices,
      }),
    });
    return unwrap(response);
  }
}

export function toAuthSession(data: TokenExchangeData): AuthSession {
  const expiresIn = data.refresh_expires_in || data.expires_in;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    user: data.user,
  };
}

function unwrap<T>(response: ApiResponse<T>): T {
  if (response.code !== 0) {
    throw new Error(response.error?.detail ?? response.message);
  }
  return response.data;
}
