import { LEVEL_FROM, useMyReputation } from "@/features/reputation/api";
import { useLocale } from "@/i18n/LocaleContext";
import { Card } from "@/shared/ui/Card";
import { CheckCircle2, MessageCircle, ThumbsUp } from "lucide-react";
import { LEVEL_KEY, LevelBadge } from "./LevelBadge";

/** Settings: your points, level and how far the next level is. */
export function MyReputationCard() {
  const { t, plural } = useLocale();
  const { data: rep } = useMyReputation();
  if (!rep) return null;

  const from = LEVEL_FROM[rep.level];
  const progress = rep.nextLevelAt ? Math.min(100, ((rep.points - from) / (rep.nextLevelAt - from)) * 100) : 100;
  const nextLevel = (Object.keys(LEVEL_FROM) as (keyof typeof LEVEL_FROM)[]).find((l) => LEVEL_FROM[l] === rep.nextLevelAt);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-primary">{t("myReputation")}</h2>
        <LevelBadge level={rep.level} className="px-2 py-1 text-xs" />
      </div>
      <p className="mt-2 text-3xl font-bold text-primary">{plural(rep.points, "points")}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-background-2" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-label">
        {nextLevel
          ? t("nextLevelIn").replace("{points}", plural(rep.nextLevelAt - rep.points, "points")).replace("{level}", t(LEVEL_KEY[nextLevel]))
          : t("topLevelReached")}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { icon: CheckCircle2, value: rep.solutions, label: t("repSolutions") },
          { icon: ThumbsUp, value: rep.likes, label: t("repLikes") },
          { icon: MessageCircle, value: rep.answers, label: t("repAnswers") },
        ].map(({ icon: Icon, value, label }) => (
          <div key={label} className="rounded-xl bg-background-2/60 px-2 py-2.5">
            <Icon className="mx-auto h-4 w-4 text-primary-light" aria-hidden />
            <p className="mt-1 text-lg font-bold text-primary">{value}</p>
            <p className="text-[11px] text-label">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-snug text-label">{t("pointsRules")}</p>
    </Card>
  );
}
