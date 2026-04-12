export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchHttpClientOptions {
  onUnauthorized?: (error: HttpError) => Promise<void> | void;
}

export interface HttpClient {
  request<T>(path: string, options?: HttpRequestOptions): Promise<T>;
  openEventStream(
    path: string,
    options: HttpRequestOptions & {
      onEvent: (event: { event: string; data: unknown }) => void;
    }
  ): Promise<void>;
}

export class FetchHttpClient implements HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly clientOptions: FetchHttpClientOptions = {}
  ) {}

  async request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: options.signal,
    });

    const responseText = await response.text();
    const responseBody = responseText ? safeJsonParse(responseText) : undefined;

    if (!response.ok) {
      const error = new HttpError(
        buildHttpErrorMessage(response.status, responseBody),
        response.status,
        responseBody
      );
      if (response.status === 401) {
        await this.clientOptions.onUnauthorized?.(error);
      }
      throw error;
    }

    return responseBody as T;
  }

  async openEventStream(
    path: string,
    options: HttpRequestOptions & {
      onEvent: (event: { event: string; data: unknown }) => void;
    }
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: options.signal,
    });
    if (!response.ok) {
      const responseText = await response.text();
      const responseBody = responseText ? safeJsonParse(responseText) : undefined;
      const error = new HttpError(
        buildHttpErrorMessage(response.status, responseBody),
        response.status,
        responseBody
      );
      if (response.status === 401) {
        await this.clientOptions.onUnauthorized?.(error);
      }
      throw error;
    }
    if (!response.body) {
      throw new Error("stream response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEventStreamChunk(rawEvent);
        if (parsed) {
          options.onEvent(parsed);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  }
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function buildHttpErrorMessage(status: number, responseBody: unknown): string {
  if (responseBody && typeof responseBody === "object") {
    const payload = responseBody as {
      message?: string;
      error?: { detail?: string };
    };
    return payload.error?.detail ?? payload.message ?? `request failed: ${status}`;
  }
  return `request failed: ${status}`;
}

function parseEventStreamChunk(input: string): { event: string; data: unknown } | null {
  const lines = input.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const raw = dataLines.join("\n");
  return {
    event,
    data: safeJsonParse(raw),
  };
}
