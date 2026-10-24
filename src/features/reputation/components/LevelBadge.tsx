import type { ReputationLevel } from "@/features/reputation/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { Award, Crown, Sparkles, Sprout } from "lucide-react";

export const LEVEL_KEY: Record<ReputationLevel, TranslationKey> = {
  newcomer: "levelNewcomer",
  helper: "levelHelper",
  expert: "levelExpert",
  master: "levelMaster",
};

const LEVEL_STYLE: Record<ReputationLevel, { icon: typeof Award; className: string }> = {
  newcomer: { icon: Sprout, className: "bg-background-2 text-label" },
  helper: { icon: Sparkles, className: "bg-sky-50 text-sky-700" },
  expert: { icon: Award, className: "bg-violet-50 text-violet-700" },
  master: { icon: Crown, className: "bg-amber-50 text-amber-700" },
};

/**
 * A student's level next to their name. Newcomers get no badge in posts
 * (hideNewcomer) so the forum isn't full of them; the badge's title shows
 * the points.
 */
export function LevelBadge({
  level,
  points,
  hideNewcomer = false,
  className,
}: {
  level?: ReputationLevel;
  points?: number;
  hideNewcomer?: boolean;
  className?: string;
}) {
  const { t, plural } = useLocale();
  if (!level || (hideNewcomer && level === "newcomer")) return null;
  const { icon: Icon, className: tone } = LEVEL_STYLE[level];
  return (
    <span
      title={points !== undefined ? plural(points, "points") : undefined}
      className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none", tone, className)}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {t(LEVEL_KEY[level])}
    </span>
  );
}
