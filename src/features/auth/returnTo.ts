import { safeSession } from "@/shared/lib/storage";

// The page a logged-out visitor asked for (a shared answer, a map place),
// kept for this tab through login, or signup + email code, so they land
// there instead of on the home page.
const KEY = "ai_helpdesk_return_to";

/** Only paths on this site, never the auth pages themselves. */
function usable(path: string | null): path is string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return false;
  return !/^\/(login|signup|verify|forgot-password|reset-password)(?:[/?#]|$)/.test(path);
}

export function rememberReturnTo(path: string) {
  if (path !== "/" && usable(path)) safeSession.set(KEY, path);
}

/** Where to go after logging in ("/" when nothing was asked for). */
export function returnToPath(): string {
  const path = safeSession.get(KEY);
  return usable(path) ? path : "/";
}

export function clearReturnTo() {
  safeSession.remove(KEY);
}
