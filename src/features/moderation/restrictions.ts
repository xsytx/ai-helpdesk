import type { Locale, TranslationKey } from "@/i18n/translations";
import { apiClient, getErrorData, getErrorStatus } from "@/shared/api/client";
import { safeSession } from "@/shared/lib/storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// Mute (can't post or edit) and ban (can't use the site), set by staff with
// a reason and an end (none = until lifted).

export type RestrictionKind = "mute" | "ban";

/** A restriction as the student sees it. */
export interface Restriction {
  kind: RestrictionKind;
  until?: string;
  reason: string;
}

/** The restriction in a 403 answer ({code: "muted" | "banned", until, reason}), if that's what it is. */
export function restrictionFrom(err: unknown): Restriction | undefined {
  if (getErrorStatus(err) !== 403) return undefined;
  const data = getErrorData(err);
  const code = data?.code;
  if (code !== "muted" && code !== "banned") return undefined;
  return {
    kind: code === "muted" ? "mute" : "ban",
    until: typeof data?.until === "string" ? data.until : undefined,
    reason: typeof data?.reason === "string" ? data.reason : "",
  };
}

/** Still in force (no end, or the end is ahead). */
export function isActive(r: Restriction | undefined): r is Restriction {
  return Boolean(r && (!r.until || new Date(r.until) > new Date()));
}

const INTL: Record<Locale, string> = { en: "en", ru: "ru", kz: "kk" };

/** "You can't post until 3 November, 14:00. Reason: …" in the site language. */
export function restrictionText(r: Restriction, t: (key: TranslationKey) => string, locale: Locale): string {
  const key: TranslationKey =
    r.kind === "mute" ? (r.until ? "mutedUntil" : "mutedForever") : r.until ? "bannedUntil" : "bannedForever";
  return t(key).replace("{until}", formatUntil(r, locale)).replace("{reason}", r.reason);
}

/** For staff: "until 3 November, 14:00 · Reason: …". */
export function restrictionSummary(r: Restriction, t: (key: TranslationKey) => string, locale: Locale): string {
  const until = r.until ? t("restrictUntil").replace("{until}", formatUntil(r, locale)) : t("restrictNoEnd");
  return `${until} · ${t("restrictReasonIs").replace("{reason}", r.reason)}`;
}

function formatUntil(r: Restriction, locale: Locale): string {
  return r.until
    ? new Date(r.until).toLocaleString(INTL[locale], { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : "";
}

// A ban noticed while logged in: kept for the login page to explain.
const BAN_KEY = "ai_helpdesk_ban";

export function rememberBan(r: Restriction) {
  safeSession.set(BAN_KEY, JSON.stringify(r));
}

export function takeBan(): Restriction | undefined {
  const raw = safeSession.get(BAN_KEY);
  safeSession.remove(BAN_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Restriction;
  } catch {
    return undefined;
  }
}

// --- Staff ---

export interface RestrictedUser {
  userId: string;
  name: string;
  email: string;
  avatar: string;
  kind: RestrictionKind;
  since: string;
  until?: string;
  reason: string;
}

export interface UserRestriction {
  staff: boolean;
  mute?: Restriction;
  ban?: Restriction;
}

const keys = {
  all: ["restrictions"] as const,
  user: (id: string) => ["restrictions", "user", id] as const,
};

/** Everyone muted or banned right now (admin panel). */
export function useRestrictedUsers() {
  return useQuery({
    queryKey: keys.all,
    queryFn: async (): Promise<RestrictedUser[]> => {
      const { data } = await apiClient.get<{
        users: { user_id: number; display_name: string; email: string; avatar: string; kind: RestrictionKind; since: string; until?: string; reason: string }[];
      }>("/admin/restrictions");
      return data.users.map((u) => ({
        userId: String(u.user_id),
        name: u.display_name,
        email: u.email,
        avatar: u.avatar,
        kind: u.kind,
        since: u.since,
        until: u.until,
        reason: u.reason,
      }));
    },
  });
}

/** One user's mute and ban in force (profile page, staff). */
export function useUserRestriction(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.user(userId),
    enabled,
    queryFn: async (): Promise<UserRestriction> => {
      const { data } = await apiClient.get<{
        staff: boolean;
        muted: boolean;
        banned: boolean;
        mute_until?: string;
        mute_reason?: string;
        ban_until?: string;
        ban_reason?: string;
      }>(`/admin/users/${userId}/restriction`);
      return {
        staff: data.staff,
        mute: data.muted ? { kind: "mute", until: data.mute_until, reason: data.mute_reason ?? "" } : undefined,
        ban: data.banned ? { kind: "ban", until: data.ban_until, reason: data.ban_reason ?? "" } : undefined,
      };
    },
  });
}

/** Mute or ban (days 0 = no end), or lift one. */
export function useSetRestriction(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { action: "set"; kind: RestrictionKind; days: number; reason: string } | { action: "lift"; kind: RestrictionKind },
    ) => {
      if (input.action === "lift") {
        await apiClient.delete(`/admin/users/${userId}/restriction`, { params: { kind: input.kind } });
      } else {
        await apiClient.post(`/admin/users/${userId}/restriction`, { kind: input.kind, days: input.days, reason: input.reason });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
    },
  });
}
