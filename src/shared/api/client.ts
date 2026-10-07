import axios, { isAxiosError } from "axios";

const TOKEN_KEY = "ai_helpdesk_token";

/** Serve forum data from localStorage instead of the backend (VITE_USE_MOCK_API=true). */
export const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API === "true";

// Defaults to same-origin /api, which the Vite dev server proxies to the Go backend
// (see vite.config.ts). Set VITE_API_URL to call a backend on another origin instead.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api",
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** HTTP status of a failed request, or undefined for network/non-HTTP errors. */
export function getErrorStatus(err: unknown): number | undefined {
  return isAxiosError(err) ? err.response?.status : undefined;
}

/** The backend's `{ error: "..." }` message, if any. */
export function getErrorMessage(err: unknown): string | undefined {
  if (!isAxiosError(err)) return undefined;
  const data = err.response?.data as { error?: unknown } | undefined;
  return typeof data?.error === "string" ? data.error : undefined;
}
