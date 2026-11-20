import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { ThumbsUp } from "lucide-react";
import type { ReviewBrief } from "../api";
import { fill } from "../labels";

/**
 * How students rate a course, small: 👍 86% · 7 (the full sentence as its
 * tooltip). Pass the display (`inline-flex`, `hidden sm:inline-flex`…) in className.
 */
export function RatingChip({ rating, className }: { rating: ReviewBrief; className?: string }) {
  const { t } = useLocale();
  const text = fill(t("coursesRatingTitle"), { pct: rating.recommend_pct, n: rating.count });
  return (
    <span
      title={text}
      aria-label={text}
      className={cn(
        "shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        rating.recommend_pct >= 70 ? "bg-green-50 text-green-700" : "bg-background-2 text-label",
        className,
      )}
    >
      <ThumbsUp className="h-3 w-3" aria-hidden />
      {rating.recommend_pct}% · {rating.count}
    </span>
  );
}
