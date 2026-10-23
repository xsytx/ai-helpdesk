import axios, { isAxiosError } from "axios";
import { safeStorage } from "@/shared/lib/storage";

export const TOKEN_KEY = "ai_helpdesk_token";

/** Serve forum data from localStorage instead of the backend (VITE_USE_MOCK_API=true). */
export const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API === "true";

// Defaults to same-origin /api, which the Vite dev server proxies to the Go backend
// (see vite.config.ts). Set VITE_API_URL to call a backend on another origin instead.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api",
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = safeStorage.get(TOKEN_KEY);
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function setAuthToken(token: string | null) {
  if (token) safeStorage.set(TOKEN_KEY, token);
  else safeStorage.remove(TOKEN_KEY);
}

export function getAuthToken(): string | null {
  return safeStorage.get(TOKEN_KEY);
}

/** A failed fetch() request (streaming calls don't go through axios). */
export class HttpStatusError extends Error {
  constructor(readonly status: number, message = `HTTP ${status}`) {
    super(message);
  }
}

/** HTTP status of a failed request, or undefined for network/non-HTTP errors. */
export function getErrorStatus(err: unknown): number | undefined {
  if (err instanceof HttpStatusError) return err.status;
  return isAxiosError(err) ? err.response?.status : undefined;
}

/**
 * POST with the login token via fetch(), for responses read while they
 * arrive (axios can't stream in the browser). Throws HttpStatusError on a
 * non-2xx answer.
 */
export async function postStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const token = getAuthToken();
  const res = await fetch(`${apiClient.defaults.baseURL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new HttpStatusError(res.status);
  return res;
}

/** The backend's `{ error: "..." }` message, if any. */
export function getErrorMessage(err: unknown): string | undefined {
  if (!isAxiosError(err)) return undefined;
  const data = err.response?.data as { error?: unknown } | undefined;
  return typeof data?.error === "string" ? data.error : undefined;
}
