// Admin panel → "Reviews": course reviews the moderation held, and reviews
// students reported. Publish (shown, reports closed), keep (reports closed)
// or reject (hidden for good). Admins see who wrote each one.
import { useLocale } from "@/i18n/LocaleContext";
import { getErrorStatus } from "@/shared/api/client";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Check, ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import { courseSlug, useAdminReviews, useDecideReview, type CourseReview } from "../api";
import { fill } from "../labels";

export function ReviewsAdminSection() {
  const { t } = useLocale();
  const { data, isPending, isError } = useAdminReviews();
  return (
    <div className="space-y-4">
      <p className="text-sm text-label">{t("reviewsAdminIntro")}</p>
      {isPending ? <p className="text-sm text-label">{t("loading")}</p> : null}
      {isError ? <p className="text-sm text-error">{t("insightsLoadFailed")}</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-label">{t("reviewsAdminEmpty")}</p> : null}
      <ul className="space-y-2">
        {data?.map((r) => <AdminReview key={r.id} review={r} />)}
      </ul>
    </div>
  );
}

function AdminReview({ review }: { review: CourseReview }) {
  const { t, locale } = useLocale();
  const decide = useDecideReview();
  const busy = decide.isPending;
  const act = (action: "publish" | "keep" | "reject") => decide.mutate({ id: review.id, action, text: review.text });
  return (
    <li className="rounded-2xl border border-surface/60 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        <span className="rounded-full bg-background-2 px-2 py-0.5 font-mono text-primary">{review.course_code}</span>
        <span className="text-primary">{review.course_name}</span>
        {review.status === "held" ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
            {fill(t("reviewsAdminHeld"), { reason: review.moderation_reason || "—" })}
          </span>
        ) : null}
        {review.open_reports ? (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">{fill(t("reviewsAdminReports"), { n: review.open_reports })}</span>
        ) : null}
        <span className="font-normal text-label">
          <Link to={`/users/${review.author_id}`} className="hover:underline">{review.author_name}</Link> · {formatRelativeTime(review.created_at, locale)}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-primary [overflow-wrap:anywhere]">{review.text}</p>
      {review.report_reasons && review.report_reasons.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-label">
          {review.report_reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to={`/courses/${courseSlug(review.course_code)}`} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            {review.course_code}
          </Link>
        </Button>
        {review.status === "held" ? (
          <Button size="sm" disabled={busy} onClick={() => act("publish")}>
            <Check className="h-4 w-4" />
            {t("reviewsAdminPublish")}
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => act("keep")}>
            <Check className="h-4 w-4" />
            {t("reviewsAdminKeep")}
          </Button>
        )}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => act("reject")}>
          <X className="h-4 w-4" />
          {t("reviewsAdminReject")}
        </Button>
      </div>
      {decide.isError ? (
        <p className="mt-2 text-sm text-error">
          {getErrorStatus(decide.error) === 409 ? t("reviewsAdminChanged") : t("moderationActionFailed")}
        </p>
      ) : null}
    </li>
  );
}
