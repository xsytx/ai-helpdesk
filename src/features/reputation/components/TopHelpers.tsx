import { useTopHelpers, type HelpersPeriod } from "@/features/reputation/api";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Card } from "@/shared/ui/Card";
import { Trophy } from "lucide-react";
import { useState } from "react";
import { LevelBadge } from "./LevelBadge";

const PERIODS: { id: HelpersPeriod; key: "helpersWeek" | "helpersMonth" | "helpersAll" }[] = [
  { id: "week", key: "helpersWeek" },
  { id: "month", key: "helpersMonth" },
  { id: "all", key: "helpersAll" },
];

const MEDAL = ["text-amber-500", "text-slate-400", "text-orange-400"];

/** Home page: the students who helped the most (points earned in the period). */
export function TopHelpers() {
  const { t, plural } = useLocale();
  const [period, setPeriod] = useState<HelpersPeriod>("week");
  const { data: helpers = [], isPending } = useTopHelpers(period);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-bold text-primary">
          <Trophy className="h-5 w-5 text-amber-500" aria-hidden />
          {t("topHelpers")}
        </h3>
      </div>
      <div className="mt-3 flex rounded-lg bg-background-2 p-0.5 text-xs font-semibold" role="group" aria-label={t("topHelpers")}>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={period === p.id}
            onClick={() => setPeriod(p.id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5",
              period === p.id ? "bg-white text-primary shadow-sm" : "text-label hover:text-primary",
            )}
          >
            {t(p.key)}
          </button>
        ))}
      </div>
      {isPending ? (
        <p className="mt-4 text-sm text-label">{t("loading")}</p>
      ) : helpers.length === 0 ? (
        <p className="mt-4 text-sm text-label">{t("helpersEmpty")}</p>
      ) : (
        <ol className="mt-3 space-y-1">
          {helpers.map((h, i) => (
            <li key={h.userId} className="flex items-center gap-3 rounded-xl px-2 py-2">
              <span className={cn("w-4 text-center text-sm font-bold", MEDAL[i] ?? "text-label")}>{i + 1}</span>
              <UserAvatar userId={h.userId} name={h.name} className="h-8 w-8 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-primary">
                  <span className="truncate">{h.name}</span>
                  <LevelBadge level={h.level} />
                </p>
                {h.solutions > 0 ? <p className="text-xs text-label">{plural(h.solutions, "solutionsCount")}</p> : null}
              </div>
              <span className="shrink-0 text-sm font-bold text-primary">+{h.points}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 border-t border-border/50 pt-3 text-[11px] leading-snug text-label">{t("pointsRules")}</p>
    </Card>
  );
}
