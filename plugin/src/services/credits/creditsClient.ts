import type { ApiResponse } from "../api-client/apiResponse";
import type { HttpClient } from "../api-client/httpClient";

export interface CreditsBalance {
  balance: number;
  currency: string;
  frozen: number;
}

export interface CreditsTransaction {
  transaction_id: string;
  transaction_type: string;
  scene: string;
  amount: number;
  balance_after: number;
  related_object_type?: string;
  related_object_uid?: string;
  remark?: string;
  created_at: string;
}

export interface CreditsTransactionsResponse {
  transactions: CreditsTransaction[];
}

export class CreditsClient {
  constructor(private readonly httpClient: HttpClient) {}

  async getBalance(accessToken: string): Promise<CreditsBalance> {
    const response = await this.httpClient.request<ApiResponse<CreditsBalance>>(
      "/api/v1/credits/balance",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.code !== 0) {
      throw new Error(response.error?.detail ?? response.message);
    }

    return response.data;
  }

  async listTransactions(accessToken: string, limit = 20): Promise<CreditsTransactionsResponse> {
    const response = await this.httpClient.request<ApiResponse<CreditsTransactionsResponse>>(
      `/api/v1/credits/transactions?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.code !== 0) {
      throw new Error(response.error?.detail ?? response.message);
    }

    return response.data;
  }
}
