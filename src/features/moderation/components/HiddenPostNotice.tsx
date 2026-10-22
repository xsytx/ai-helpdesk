import { useAuth } from "@/app/AuthContext";
import type { ModerationStatus } from "@/entities/forum";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { EyeOff } from "lucide-react";
import { isStaffRole } from "../api";

/**
 * Explains why a post is hidden from others. Only its author and moderators
 * ever receive held/rejected posts from the API, so this renders nothing for
 * visible posts.
 */
export function HiddenPostNotice({
  status,
  authorId,
  compact = false,
  className,
}: {
  status?: ModerationStatus;
  authorId: string;
  /** One-line badge (answers) instead of the full explanation (questions). */
  compact?: boolean;
  className?: string;
}) {
  const { user } = useAuth();
  const { t } = useLocale();
  if (status !== "held" && status !== "rejected") return null;

  const rejected = status === "rejected";
  const isAuthor = user?.id === authorId;
  const title = !isAuthor && isStaffRole(user?.role)
    ? t("postHiddenStaff")
    : rejected
      ? t("postRejectedTitle")
      : t("postUnderReviewTitle");
  const tone = rejected ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900";

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone, className)}>
        <EyeOff className="h-3 w-3" aria-hidden />
        {title}
      </span>
    );
  }
  return (
    <div role="status" className={cn("flex gap-2.5 rounded-xl border px-4 py-3 text-sm", tone, className)}>
      <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        {isAuthor ? <p className="mt-0.5">{rejected ? t("postRejectedBody") : t("postUnderReviewBody")}</p> : null}
      </div>
    </div>
  );
}
