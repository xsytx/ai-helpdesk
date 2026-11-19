// "My reviews" at the bottom of the Courses page: every course you reviewed, with its
// moderation status, your scores as a small hexagon and a link to the course
// (edit or delete it there). Only you see this list: reviews are anonymous
// to other students, so it is never shown on anyone's profile.
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { SkeletonList } from "@/shared/ui/Skeleton";
import { Clock, EyeOff, ThumbsDown, ThumbsUp } from "lucide-react";
import { Link } from "react-router-dom";
import { courseSlug, useMyReviews, type ReviewTerm } from "../api";
import { ReviewHexagon } from "./ReviewHexagon";

const TERM_KEY: Record<ReviewTerm, TranslationKey> = { fall: "reviewsTermFall", spring: "reviewsTermSpring", summer: "reviewsTermSummer" };

export function MyReviews() {
  const { t, locale } = useLocale();
  const { data: reviews = [], isPending } = useMyReviews();
  if (isPending) return <SkeletonList rows={2} />;
  if (reviews.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-label">
        <p>{t("profileNoReviews")}</p>
        <p className="mt-1 text-xs">{t("coursesMyReviewsHow")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-label">{t("profileReviewsHint")}</p>
      <ul className="divide-y divide-border/40">
        {reviews.map((r) => (
          <li key={r.id} className="flex gap-3 py-3">
            <ReviewHexagon scores={r} size="sm" className="shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <Link
                to={`/courses/${courseSlug(r.course_code)}`}
                viewTransition
                className="block text-sm font-semibold text-primary hover:underline"
              >
                <span className="font-mono text-xs text-label">{r.course_code}</span> {r.course_name}
              </Link>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold",
                    r.recommend ? "bg-green-50 text-green-700" : "bg-red-50 text-red-800",
                  )}
                >
                  {r.recommend ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
                  {t(r.recommend ? "reviewsRecommends" : "reviewsNotRecommends")}
                </span>
                {r.status !== "ok" ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
                    {r.status === "checking" ? <Clock className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {t(r.status === "checking" ? "reviewsChecking" : r.status === "held" ? "reviewsHeld" : "reviewsRejected")}
                  </span>
                ) : null}
                {r.helpful > 0 ? (
                  <span className="inline-flex items-center gap-1 text-label">
                    <ThumbsUp className="h-3 w-3" />
                    {r.helpful}
                  </span>
                ) : null}
              </div>
              <p className="line-clamp-2 text-sm text-primary [overflow-wrap:anywhere]">{r.text}</p>
              <p className="text-xs text-label">
                {t(TERM_KEY[r.taken_term])} {r.taken_year} · {formatRelativeTime(r.created_at, locale)}
                {r.edited_at ? ` · ${t("reviewsEdited")}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
