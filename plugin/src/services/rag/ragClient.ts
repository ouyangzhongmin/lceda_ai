import type { HttpClient } from "../api-client/httpClient";
import type { ApiResponse } from "../api-client/apiResponse";

export interface RagSearchResult {
  chunk_id: string;
  score: number;
  title: string;
  snippet: string;
  source_ref: string;
  kb_type: string;
}

export interface RagSearchResponse {
  results: RagSearchResult[];
}

export interface RagCitationPackage {
  query: string;
  results: RagSearchResult[];
}

export class RagClient {
  constructor(private readonly httpClient: HttpClient) {}

  async search(query: string, topK = 3): Promise<RagSearchResponse> {
    const response = await this.httpClient.request<ApiResponse<RagSearchResponse>>(
      "/api/v1/rag/search",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          top_k: topK,
        }),
      }
    );

    if (response.code !== 0) {
      throw new Error(response.error?.detail ?? response.message);
    }

    return response.data;
  }

  async buildCitations(query: string, topK = 3): Promise<RagCitationPackage> {
    const response = await this.httpClient.request<ApiResponse<RagCitationPackage>>(
      "/api/v1/rag/citations:build",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          top_k: topK,
        }),
      }
    );

    if (response.code !== 0) {
      throw new Error(response.error?.detail ?? response.message);
    }

    return response.data;
  }
}
