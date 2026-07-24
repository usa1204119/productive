import type { ApiResponse, ErrorCode } from "@plane-and-curves/shared";

/** Error thrown by the API client, carrying the canonical code. */
export class ApiClientError extends Error {
  readonly code: ErrorCode | "NETWORK_ERROR";
  constructor(code: ErrorCode | "NETWORK_ERROR", message: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
  }
}

/**
 * Thin fetch wrapper: always sends the session cookie, always parses the
 * standard { success, data | error } envelope, and throws ApiClientError on
 * failure so callers switch on `code`, never on message text.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not reach the server");
  }

  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new ApiClientError("INTERNAL_ERROR", "Malformed server response");
  if (!body.success) throw new ApiClientError(body.error.code, body.error.message);
  return body.data;
}
