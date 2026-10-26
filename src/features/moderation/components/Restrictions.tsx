import { useAuth } from "@/app/AuthContext";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Ban, MicOff } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  isActive,
  restrictionSummary,
  restrictionText,
  useRestrictedUsers,
  useSetRestriction,
  useUserRestriction,
  type Restriction,
  type RestrictionKind,
} from "../restrictions";

/** For a muted student, above the question/answer forms: why and until when. */
export function MutedNotice({ restriction, className }: { restriction?: Restriction; className?: string }) {
  const { user } = useAuth();
  const { t, locale } = useLocale();
  const r = restriction ?? user?.mute;
  if (!isActive(r)) return null;
  return (
    <p className={cn("rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900", className)} role="status">
      {restrictionText(r, t, locale)}
    </p>
  );
}

const DURATIONS = [1, 3, 7, 30, 0] as const;

/** On a student's profile, for staff: mute or ban with a reason and an end, or lift it. */
export function RestrictionPanel({ userId }: { userId: string }) {
  const { t, locale } = useLocale();
  const current = useUserRestriction(userId, true);
  const set = useSetRestriction(userId);
  const [kind, setKind] = useState<RestrictionKind>("mute");
  const [days, setDays] = useState<number>(3);
  const [reason, setReason] = useState("");

  if (!current.data || current.data.staff) return null;
  const active = [current.data.ban, current.data.mute].filter(isActive);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    await set.mutateAsync({ action: "set", kind, days, reason: reason.trim() });
    setReason("");
    void current.refetch();
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-primary">{t("restrictTitle")}</h2>
      {active.map((r) => (
        <div key={r.kind} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            <b>{t(r.kind === "ban" ? "restrictBan" : "restrictMute")}:</b> {restrictionSummary(r, t, locale)}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={set.isPending}
            onClick={() => void set.mutateAsync({ action: "lift", kind: r.kind }).then(() => current.refetch())}
          >
            {t("restrictLift")}
          </Button>
        </div>
      ))}
      <form onSubmit={submit} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {(["mute", "ban"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold",
                kind === k ? "border-brand bg-brand text-white" : "border-border bg-surface text-primary hover:bg-background-2",
              )}
            >
              {k === "mute" ? <MicOff className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
              {t(k === "mute" ? "restrictMute" : "restrictBan")}
            </button>
          ))}
        </div>
        <p className="text-xs text-label">{t(kind === "mute" ? "restrictMuteHint" : "restrictBanHint")}</p>
        <label className="block text-xs font-medium text-label">
          {t("restrictFor")}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="ml-2 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-primary"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t("restrictNoEnd") : d === 1 ? t("restrictDay1") : d === 3 ? t("restrictDay3") : d === 7 ? t("restrictWeek") : t("restrictMonth")}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={t("restrictReasonPlaceholder")}
          aria-label={t("restrictReason")}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        />
        {set.isError ? <p className="text-xs text-error">{t("postActionFailed")}</p> : null}
        <Button type="submit" size="sm" disabled={set.isPending || !reason.trim()}>
          {t(kind === "mute" ? "restrictMuteButton" : "restrictBanButton")}
        </Button>
      </form>
    </div>
  );
}

/** Admin panel → Restrictions: everyone muted or banned now, to review or lift. */
export function RestrictionsSection() {
  const { t, locale } = useLocale();
  const { data, isPending, isError } = useRestrictedUsers();
  if (isPending) return <p className="text-sm text-label">{t("loading")}</p>;
  if (isError) return <p className="text-sm text-error">{t("serverUnavailable")}</p>;
  if (data.length === 0) return <p className="text-sm text-label">{t("restrictNone")}</p>;
  return (
    <ul className="space-y-2">
      {data.map((u) => (
        <li key={`${u.userId}-${u.kind}`} className="flex items-start gap-3 rounded-2xl border border-surface/60 bg-surface p-4 shadow-sm">
          <UserAvatar userId={u.userId} name={u.name} avatar={u.avatar} className="h-9 w-9 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Link viewTransition to={`/users/${u.userId}`} className="font-semibold text-primary hover:underline">
                {u.name}
              </Link>
              <span className="text-xs text-label">{u.email}</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                {t(u.kind === "ban" ? "restrictBan" : "restrictMute")}
              </span>
            </p>
            <p className="mt-1 text-sm text-primary/90">{restrictionSummary(u, t, locale)}</p>
            <p className="mt-0.5 text-xs text-label">{t("restrictSince").replace("{time}", formatRelativeTime(u.since, locale))}</p>
          </div>
          <Link viewTransition to={`/users/${u.userId}`} className="shrink-0 text-xs font-semibold text-primary-light hover:underline">
            {t("restrictOpenProfile")}
          </Link>
        </li>
      ))}
    </ul>
  );
}
