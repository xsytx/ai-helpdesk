import type { Role, User } from "@/entities/user";
import { apiClient } from "@/shared/api/client";

/** User as returned by the Go backend (`userPublic` in internal/handlers/auth.go). */
export interface ApiUser {
  id: number;
  email: string;
  display_name: string;
  role: "user" | "moderator" | "admin";
  major: string;
  bio: string;
  email_verified: boolean;
}

interface AuthResponse {
  token: string;
  user: ApiUser;
  /** Only present when the backend has no SMTP configured (local dev). */
  dev_verification_code?: string;
}

export function toUser(u: ApiUser): User {
  const role: Role = u.role === "user" ? "student" : u.role;
  return {
    id: String(u.id),
    email: u.email,
    name: u.display_name,
    role,
    emailVerified: u.email_verified,
  };
}

export async function loginRequest(email: string, password: string) {
  const { data } = await apiClient.post<AuthResponse>("/login", { email, password });
  return data;
}

export async function registerRequest(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  const { data } = await apiClient.post<AuthResponse>("/register", {
    email: input.email,
    password: input.password,
    display_name: input.displayName,
  });
  return data;
}

export async function fetchMe() {
  const { data } = await apiClient.get<ApiUser>("/me");
  return data;
}

// Verification runs before the user is logged in on this client, so the token
// from /register or /login is passed explicitly rather than read from storage.
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

export async function verifyEmailRequest(token: string, code: string) {
  await apiClient.post("/verify-email", { code }, bearer(token));
}

export async function resendVerificationRequest(token: string) {
  const { data } = await apiClient.post<{ dev_verification_code?: string }>(
    "/resend-verification",
    {},
    bearer(token),
  );
  return data.dev_verification_code;
}

/** Emails a 6-digit reset code. Returns the code itself only in local dev (no SMTP). */
export async function forgotPasswordRequest(email: string) {
  const { data } = await apiClient.post<{ dev_reset_code?: string }>("/forgot-password", { email });
  return data.dev_reset_code;
}

/** Checks a reset code without using it up (400 if wrong or expired). */
export async function verifyResetCodeRequest(email: string, code: string) {
  await apiClient.post("/reset-password/verify", { email, code });
}

export async function resetPasswordRequest(email: string, code: string, newPassword: string) {
  await apiClient.post("/reset-password", { email, code, new_password: newPassword });
}

// --- Pending code entry: email verification after sign up / login, or a password reset ---

const PENDING_KEY = "ai_helpdesk_pending_verify";

export type PendingVerify =
  | { purpose: "signup"; token: string; user: User; devCode?: string }
  | { purpose: "reset"; email: string; devCode?: string };

export function savePending(pending: PendingVerify) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function readPending(): PendingVerify | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingVerify>;
    // Ignore anything not in the current shape (e.g. left by the old demo login).
    if (p.purpose === "signup" && "token" in p && "user" in p && p.token && p.user) {
      return p as PendingVerify;
    }
    if (p.purpose === "reset" && "email" in p && p.email) return p as PendingVerify;
    return null;
  } catch {
    return null;
  }
}

export function clearPending() {
  sessionStorage.removeItem(PENDING_KEY);
}
