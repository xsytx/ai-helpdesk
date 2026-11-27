// Course reviews on a course's card (stories 17-18): the averages, the
// student's own review (write, edit, delete; its moderation status), and the
// others' reviews without names, newest or most helpful first, with
// "helpful" and "report". Staff also see who wrote each review.
import { restrictionFrom, restrictionText } from "@/features/moderation/restrictions";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { getErrorData, getErrorStatus } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Mascot } from "@/shared/ui/Mascot";
import { Clock, EyeOff, Flag, PenLine, Sparkles, ThumbsDown, ThumbsUp, Trash2, TriangleAlert } from "lucide-react";
import { prefersReducedMotion } from "@/shared/lib/motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  useCourseReviews, useDeleteReview, useReportReview, useReviewAISummary, useReviewHelpful, useSaveReview,
  type CourseReview, type ReviewAISummary, type ReviewInput, type ReviewSummary, type ReviewTerm,
} from "../api";
import { ReviewHexagon, type ReviewScores } from "./ReviewHexagon";

const TERM_KEY: Record<ReviewTerm, TranslationKey> = { fall: "reviewsTermFall", spring: "reviewsTermSpring", summer: "reviewsTermSummer" };
/** The six scores of a review (about the course, not its instructor); the hexagon shows them. */
const SCORES: { key: keyof ReviewScores; label: TranslationKey; low: TranslationKey; high: TranslationKey }[] = [
  { key: "usefulness", label: "reviewsUsefulness", low: "reviewsLow", high: "reviewsHigh" },
  { key: "interest", label: "reviewsInterest", low: "reviewsBoring", high: "reviewsInterestingEnd" },
  { key: "practical", label: "reviewsPractical", low: "reviewsTheoryEnd", high: "reviewsPracticeEnd" },
  { key: "beginner", label: "reviewsBeginner", low: "reviewsNeedsBase", high: "reviewsFromZero" },
  { key: "difficulty", label: "reviewsDifficulty", low: "reviewsEasy", high: "reviewsHard" },
  { key: "workload", label: "reviewsWorkload", low: "reviewsLight", high: "reviewsHeavy" },
];

export function CourseReviews({ code }: { code: string }) {
  const { t, plural } = useLocale();
  const [sort, setSort] = useState<"new" | "helpful">("new");
  const { data, isPending, isError } = useCourseReviews(code, sort);
  const [editing, setEditing] = useState(false);
  const mine = data?.reviews.find((r) => r.mine);
  const others = data?.reviews.filter((r) => !r.mine) ?? [];

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-label">
          {t("reviewsTitle")}
          {data && data.summary.count > 0 ? ` · ${plural(data.summary.count, "reviewsCount")}` : ""}
        </h2>
        {data && others.length > 1 ? (
          <div className="inline-flex rounded-xl border border-border bg-surface p-0.5 text-xs font-semibold" role="group">
            {(["new", "helpful"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={sort === s}
                onClick={() => setSort(s)}
                className={cn("rounded-lg px-2.5 py-1", sort === s ? "bg-brand text-white" : "text-label hover:text-primary")}
              >
                {t(s === "new" ? "reviewsSortNew" : "reviewsSortHelpful")}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isPending ? <div className="h-24 animate-pulse rounded-2xl bg-background-2" /> : null}
      {isError ? <p className="text-sm text-error">{t("coursesLoadFailed")}</p> : null}
      {data && data.summary.count > 0 ? <Summary summary={data.summary} /> : null}
      {data && data.summary.count > 0 ? <AISummary code={code} reviewCount={data.summary.count} /> : null}

      {data ? (
        editing || !mine ? (
          editing ? (
            <ReviewForm code={code} initial={mine} onDone={() => setEditing(false)} />
          ) : (
            <Button size="sm" onClick={() => setEditing(true)}>
              <PenLine className="h-4 w-4" />
              {t("reviewsWrite")}
            </Button>
          )
        ) : (
          <ReviewItem review={mine} code={code} onEdit={() => setEditing(true)} />
        )
      ) : null}

      {data && data.reviews.length === 0 && !editing ? (
        <p className="flex items-center gap-3 text-sm text-label">
          <Mascot mood="think" size="sm" />
          {t("reviewsNone")}
        </p>
      ) : null}

      {others.length > 0 ? (
        <ul className="divide-y divide-border/60">
          {others.map((r) => (
            <li key={r.id} className="py-3">
              <ReviewItem review={r} code={code} />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Summary({ summary }: { summary: ReviewSummary }) {
  const { t, plural } = useLocale();
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-background-2/60 p-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="w-full max-w-[420px]">
        <p className="text-xs font-semibold uppercase tracking-wide text-label">{t("reviewsHexTitle")}</p>
        <ReviewHexagon scores={summary} />
      </div>
      <div className="space-y-2 text-center sm:text-left">
        <div>
          <p className="text-xs text-label">{t("reviewsRecommendQ")}</p>
          <p className="text-2xl font-bold text-primary">{summary.recommend_pct}%</p>
        </div>
        <p className="text-xs text-label">{plural(summary.count, "reviewsCount")}</p>
        <p className="max-w-56 text-[11px] text-label">{t("reviewsHexHint")}</p>
      </div>
    </div>
  );
}

const AI_SUMMARY_MIN = 3;

/**
 * The AI's overview of the published reviews, shown when the student asks for
 * it (a button). Made on the server and saved until the reviews change, so a
 * click usually shows the saved one at once. Fewer than 3 reviews: a short
 * note instead; the AI off or failing: a short message.
 */
function AISummary({ code, reviewCount }: { code: string; reviewCount: number }) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const { data, isPending, isError } = useReviewAISummary(code, locale, reviewCount, open);
  if (reviewCount < AI_SUMMARY_MIN || data?.status === "too_few") {
    return (
      <p className="flex items-center gap-2 text-xs text-label">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        {t("reviewsAiSoon").replace("{n}", String(data?.status === "too_few" ? data.min : AI_SUMMARY_MIN))}
      </p>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" />
        {t("reviewsAiButton")}
      </Button>
    );
  }
  if (isError || data?.status === "unavailable") {
    return (
      <p className="flex items-center gap-2 text-sm text-label" role="status">
        <Sparkles className="h-4 w-4 shrink-0" />
        {t("reviewsAiUnavailable")}
      </p>
    );
  }
  if (isPending) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-dashed border-border px-3 py-2.5 text-sm text-label" aria-live="polite">
        <Sparkles className="h-4 w-4 shrink-0 animate-pulse motion-reduce:animate-none" />
        {t("reviewsAiLoading")}
      </p>
    );
  }
  if (data?.status !== "ready") return null;
  return <AISummaryCard summary={data.summary} onHide={() => setOpen(false)} />;
}

/** Text pieces split after spaces: the typing below shows them word by word. */
const words = (text: string) => text.split(/(?<=\s)/);
const TYPE_MS = 45;

/**
 * Shows the summary word by word, the way the chat's answers appear: first
 * the overview, then each point. (The summary is already complete; this is
 * only how it is shown. Less motion asked for: all at once.)
 */
function useTyping(parts: string[]) {
  const pieces = parts.map(words);
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const key = parts.join("\n");
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? total : 0));
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(total);
      return;
    }
    setShown(0);
    const timer = window.setInterval(() => {
      setShown((n) => {
        if (n + 1 >= total) window.clearInterval(timer);
        return Math.min(total, n + 1);
      });
    }, TYPE_MS);
    return () => window.clearInterval(timer);
  }, [key, total]);
  let start = 0;
  const visible = pieces.map((p) => {
    const text = p.slice(0, Math.max(0, shown - start)).join("");
    start += p.length;
    return text;
  });
  return { visible, done: shown >= total };
}

function AISummaryCard({ summary: s, onHide }: { summary: ReviewAISummary; onHide: () => void }) {
  const { t } = useLocale();
  const { visible, done } = useTyping([s.summary, ...s.liked, ...s.warnings]);
  const text = visible[0];
  const liked = visible.slice(1, 1 + s.liked.length).filter(Boolean);
  const warnings = visible.slice(1 + s.liked.length).filter(Boolean);
  // The blinking caret sits at the end of whatever is being typed now.
  const typingIn = done ? "" : warnings.length ? "warnings" : liked.length ? "liked" : "summary";
  return (
    <section className="space-y-2.5 rounded-2xl border border-brand/25 bg-background-2/50 p-3" aria-label={t("reviewsAiTitle")} aria-busy={!done}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-primary">
          <Sparkles className={cn("h-4 w-4 text-brand dark:text-primary", !done && "animate-pulse")} />
          {t("reviewsAiTitle")}
        </h3>
        <button type="button" onClick={onHide} className="text-xs font-semibold text-label hover:text-primary">
          {t("reviewsAiHide")}
        </button>
      </div>
      <p className="text-sm text-primary [overflow-wrap:anywhere]">
        {text}
        {typingIn === "summary" ? <Caret /> : null}
      </p>
      {liked.length > 0 || warnings.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <AIPoints title={t("reviewsAiLiked")} items={liked} good caret={typingIn === "liked"} />
          <AIPoints title={t("reviewsAiWarnings")} items={warnings} caret={typingIn === "warnings"} />
        </div>
      ) : null}
      {done ? (
        <p className="text-[11px] text-label">
          {t("reviewsAiBasedOn").replace("{n}", String(s.review_count))} · {t("reviewsAiNote")}
        </p>
      ) : null}
    </section>
  );
}

/** The blinking bar after the text being typed. */
function Caret() {
  return <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.15em] animate-pulse bg-brand dark:bg-primary" />;
}

function AIPoints({ title, items, good, caret }: { title: string; items: string[]; good?: boolean; caret?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={cn("flex items-center gap-1 text-xs font-semibold", good ? "text-green-700 dark:text-green-400" : "text-amber-800 dark:text-amber-300")}>
        {good ? <ThumbsUp className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
        {title}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm text-primary">
        {items.map((item, i) => (
          // Index keys: while typing, the text of an item changes word by word.
          <li key={i} className="flex gap-1.5 [overflow-wrap:anywhere]">
            <span aria-hidden="true" className="text-label">•</span>
            <span>
              {item}
              {caret && i === items.length - 1 ? <Caret /> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewItem({ review, code, onEdit }: { review: CourseReview; code: string; onEdit?: () => void }) {
  const { t, locale } = useLocale();
  const helpful = useReviewHelpful();
  const remove = useDeleteReview(code);
  const [reporting, setReporting] = useState(false);
  return (
    <div className={cn("flex gap-3", review.mine && "rounded-2xl border border-brand/30 bg-background-2/40 p-3")}>
      {/* This student's scores as a small hexagon (its tooltip lists them). */}
      <ReviewHexagon scores={review} size="sm" className="shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {review.mine ? <span className="rounded-lg bg-brand px-2 py-0.5 text-xs font-semibold text-white">{t("reviewsMine")}</span> : null}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold",
            review.recommend ? "bg-green-50 text-green-700" : "bg-red-50 text-red-800",
          )}
        >
          {review.recommend ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
          {t(review.recommend ? "reviewsRecommends" : "reviewsNotRecommends")}
        </span>
      </div>

      {review.mine && review.status !== "ok" ? (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
          {review.status === "checking" ? <Clock className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {t(review.status === "checking" ? "reviewsChecking" : review.status === "held" ? "reviewsHeld" : "reviewsRejected")}
        </p>
      ) : null}

      <p className="whitespace-pre-wrap text-sm text-primary [overflow-wrap:anywhere]">{review.text}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-label">
        <span>
          {t(TERM_KEY[review.taken_term])} {review.taken_year} · {formatRelativeTime(review.created_at, locale)}
          {review.edited_at ? ` · ${t("reviewsEdited")}` : ""}
        </span>
        {review.author_name ? (
          <Link to={`/users/${review.author_id}`} className="font-semibold text-brand hover:underline dark:text-primary">
            {review.author_name}
          </Link>
        ) : null}
        {review.mine ? (
          <>
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline dark:text-primary">
              <PenLine className="h-3.5 w-3.5" />
              {t("reviewsEdit")}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => window.confirm(t("reviewsDeleteConfirm")) && remove.mutate()}
              className="inline-flex items-center gap-1 font-semibold text-label hover:text-error"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("reviewsDelete")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-pressed={review.helped_by_me}
              disabled={helpful.isPending}
              onClick={() => helpful.mutate({ id: review.id, helpful: !review.helped_by_me })}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold transition-colors",
                review.helped_by_me ? "border-brand bg-brand text-white" : "border-border text-primary hover:bg-background-2",
              )}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              {t("reviewsHelpful")} {review.helpful > 0 ? review.helpful : ""}
            </button>
            <button type="button" onClick={() => setReporting((v) => !v)} className="inline-flex items-center gap-1 hover:text-primary">
              <Flag className="h-3.5 w-3.5" />
              {t("reviewsReport")}
            </button>
          </>
        )}
      </div>
      {reporting ? <ReportForm id={review.id} onDone={() => setReporting(false)} /> : null}
      </div>
    </div>
  );
}

function ReportForm({ id, onDone }: { id: number; onDone: () => void }) {
  const { t } = useLocale();
  const report = useReportReview();
  const [reason, setReason] = useState("");
  if (report.isSuccess) return <p className="text-xs text-green-700">{t("reviewsReported")}</p>;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        report.mutate({ id, reason: reason.trim() });
      }}
    >
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        placeholder={t("reviewsReportReason")}
        aria-label={t("reviewsReportReason")}
        className="min-w-0 basis-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-primary outline-none focus:border-brand sm:basis-auto sm:flex-1"
      />
      <Button type="submit" size="sm" variant="secondary" className="h-8" disabled={report.isPending}>
        {t("reviewsReportSend")}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onDone}>
        {t("cancel")}
      </Button>
      {report.isError ? (
        <p className="w-full text-xs text-error">{getErrorStatus(report.error) === 409 ? t("reviewsReportedAlready") : t("reviewsFailed")}</p>
      ) : null}
    </form>
  );
}

/** One row of 1–5 buttons, the ends labelled under them ("easy … hard"), so a row is only as wide as its buttons. */
function ScorePicker({ label, low, high, value, onChange }: { label: string; low: string; high: string; value: number; onChange: (v: number) => void }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold text-label">{label}</legend>
      <div className="mt-1 inline-flex flex-col">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            aria-label={`${label}: ${n}/5`}
            onClick={() => onChange(n)}
            className={cn(
              "h-8 w-8 rounded-lg border text-sm font-semibold transition-colors",
              value === n ? "border-brand bg-brand text-white" : "border-border bg-surface text-primary hover:bg-background-2",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between gap-2 text-[11px] leading-tight text-label">
        <span>{low}</span>
        <span className="text-right">{high}</span>
      </div>
      </div>
    </fieldset>
  );
}

/** The last term that has ended: before June the autumn before, else this spring. */
function lastFinishedTerm(d: Date): { term: ReviewTerm; year: number } {
  return d.getMonth() < 5 ? { term: "fall", year: d.getFullYear() - 1 } : { term: "spring", year: d.getFullYear() };
}

function ReviewForm({ code, initial, onDone }: { code: string; initial?: CourseReview; onDone: () => void }) {
  const { t, locale } = useLocale();
  const save = useSaveReview(code);
  const now = new Date().getFullYear();
  const last = lastFinishedTerm(new Date());
  // "Recommend?" starts unanswered (null): a preset Yes would count for students who never chose it.
  const [form, setForm] = useState<Omit<ReviewInput, "recommend"> & { recommend: boolean | null }>({
    difficulty: initial?.difficulty ?? 0,
    workload: initial?.workload ?? 0,
    usefulness: initial?.usefulness ?? 0,
    interest: initial?.interest ?? 0,
    practical: initial?.practical ?? 0,
    beginner: initial?.beginner ?? 0,
    recommend: initial?.recommend ?? null,
    text: initial?.text ?? "",
    taken_year: initial?.taken_year ?? last.year,
    taken_term: initial?.taken_term ?? last.term,
  });
  const textLen = form.text.trim().length;
  const complete = SCORES.every((s) => form[s.key] > 0) && form.recommend !== null && textLen >= 20;

  let problem: string | undefined;
  if (save.isError) {
    const r = restrictionFrom(save.error);
    problem =
      getErrorData(save.error)?.code === "breaks_rules"
        ? t("reviewsBreaksRules")
        : r?.kind === "mute"
          ? `${t("reviewsMuted")} ${restrictionText(r, t, locale)}`
          : t("reviewsFailed");
  }

  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && form.recommend !== null) save.mutate({ ...form, recommend: form.recommend, text: form.text.trim() }, { onSuccess: onDone });
      }}
    >
      {/* The hexagon beside the scores only when there is room for both; else under them. */}
      <div className="flex flex-col items-center gap-3 xl:flex-row xl:items-start">
        <div className="grid w-full gap-x-6 gap-y-3 sm:w-auto sm:grid-cols-2">
          {SCORES.map((s) => (
            <ScorePicker key={s.key} label={t(s.label)} low={t(s.low)} high={t(s.high)} value={form[s.key]} onChange={(v) => setForm({ ...form, [s.key]: v })} />
          ))}
        </div>
        {/* The shape the student is drawing, as they choose. */}
        <ReviewHexagon scores={form} className="w-full max-w-[320px] shrink-0 xl:ml-auto" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset>
          <legend className="text-xs font-semibold text-label">{t("reviewsRecommendQ")}</legend>
          <div className="mt-1 inline-flex rounded-xl border border-border bg-surface p-0.5 text-sm font-semibold">
            {([true, false] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={form.recommend === v}
                onClick={() => setForm({ ...form, recommend: v })}
                className={cn("rounded-lg px-3 py-1", form.recommend === v ? "bg-brand text-white" : "text-label hover:text-primary")}
              >
                {t(v ? "reviewsYes" : "reviewsNo")}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <fieldset>
        <legend className="text-xs font-semibold text-label">{t("reviewsTaken")}</legend>
        <div className="mt-1 flex gap-2">
          <select
            value={form.taken_term}
            onChange={(e) => setForm({ ...form, taken_term: e.target.value as ReviewTerm })}
            className="rounded-xl border border-border bg-surface px-2.5 py-1.5 text-sm text-primary"
          >
            {(Object.keys(TERM_KEY) as ReviewTerm[]).map((term) => (
              <option key={term} value={term}>{t(TERM_KEY[term])}</option>
            ))}
          </select>
          <select
            value={form.taken_year}
            onChange={(e) => setForm({ ...form, taken_year: Number(e.target.value) })}
            className="rounded-xl border border-border bg-surface px-2.5 py-1.5 text-sm text-primary"
          >
            {Array.from({ length: 8 }, (_, i) => now - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </fieldset>
      <label className="block text-xs font-semibold text-label">
        {t("reviewsTextLabel")}
        <textarea
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          rows={4}
          maxLength={2000}
          placeholder={t("reviewsTextPlaceholder")}
          className="mt-1 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary outline-none placeholder:text-placeholder focus:border-brand"
        />
      </label>
      <p className="flex flex-wrap justify-between gap-2 text-xs text-label">
        <span>{t("reviewsAnonymous")}</span>
        <span className={textLen > 0 && textLen < 20 ? "text-error" : undefined}>
          {textLen > 0 && textLen < 20 ? `${t("reviewsTextShort")} ` : ""}
          {textLen}/2000
        </span>
      </p>
      {problem ? <p className="text-sm text-error" role="alert">{problem}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!complete || save.isPending}>
          {t("reviewsSend")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
