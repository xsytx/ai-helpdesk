// Admin panel → Dashboard (sprint 7, story 19): how the AI chat and the forum
// are used in the last 7 / 30 / 90 days, the questions students ask most and
// the ones nobody answered yet, without student names. "Make it an FAQ" opens
// the FAQ editor with the question filled in (like the "AI chat" section).
import { insightToFaqDraft } from "@/features/chat/insights";
import { courseSlug } from "@/features/courses/api";
import type { FaqDraft } from "@/features/faq/api";
import { usePendingModerationCount } from "@/features/moderation/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { useIsPhone } from "@/shared/lib/media";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { SkeletonBlock } from "@/shared/ui/Skeleton";
import { BookPlus, ChevronRight, Cpu, GraduationCap, MessageCircleQuestion, MessagesSquare, ThumbsDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAdminDashboard, type Dashboard, type DashboardDay, type DashboardPeriod } from "../dashboard";

const PERIODS: DashboardPeriod[] = [7, 30, 90];
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
/** A share in %, "<1" when there is some but it rounds to 0 (2 of 490 is not "0%"). */
const pct = (part: number, whole: number) => {
  const p = whole > 0 ? Math.round((100 * part) / whole) : 0;
  return p === 0 && part > 0 ? "<1" : String(p);
};

export function DashboardSection({ onMakeFaq, onOpenSection }: {
  onMakeFaq: (draft: FaqDraft) => void;
  onOpenSection: (id: "moderation" | "chat") => void;
}) {
  const { t, locale, plural } = useLocale();
  const [days, setDays] = useState<DashboardPeriod>(7);
  const { data, isPending, isError } = useAdminDashboard(days);
  const pending = usePendingModerationCount().data ?? 0;

  if (isError) return <p className="text-sm text-error">{t("dashLoadFailed")}</p>;
  if (isPending || !data) return <SkeletonBlock className="h-96" />;
  const s = data.totals;
  const p = data.previous;
  const rated = s.liked + s.disliked;
  // "↑ 35% vs the previous 7 days" under a tile (nothing when both are 0).
  const vs = (now: number, before: number, badWhenUp = false) => <Delta now={now} before={before} days={days} badWhenUp={badWhenUp} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-label">{t("dashIntro")}</p>
        <div className="flex gap-1 rounded-xl bg-surface p-1" role="tablist" aria-label={t("dashPeriod")}>
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={days === d}
              onClick={() => setDays(d)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
                days === d ? "bg-brand text-white" : "text-primary hover:bg-background-2",
              )}
            >
              {fill(t("dashDays"), { n: d })}
            </button>
          ))}
        </div>
      </div>

      <AIQuota data={data} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("dashChatQuestions")} value={s.chat_questions}
          sub={fill(t("dashUnansweredShare"), { n: s.unanswered, pct: pct(s.unanswered, s.chat_questions) })} warn={s.unanswered > 0}
          delta={vs(s.chat_questions, p.chat_questions)} />
        <Tile label={t("dashAiToday")} value={s.ai_answers_today} sub={fill(t("dashAiPeriod"), { n: s.ai_answers })}
          delta={vs(s.ai_answers, p.ai_answers)} />
        <Tile label={t("dashRatings")} value={`👍 ${s.liked} · 👎 ${s.disliked}`}
          sub={rated > 0 ? fill(t("dashLikedShare"), { pct: pct(s.liked, rated) }) : t("dashNoRatings")}
          delta={vs(s.disliked, p.disliked, true)} deltaLabel="👎" />
        <Tile label={t("dashStudents")} value={s.active_students}
          sub={fill(t("dashStudentsSub"), { new: s.new_students, all: s.total_students })}
          delta={vs(s.active_students, p.active_students)} />
        <Tile label={t("dashForumQuestions")} value={s.forum_questions} sub={fill(t("dashForumAnswersSub"), { n: s.forum_answers })}
          delta={vs(s.forum_questions, p.forum_questions)} />
        <Tile label={t("dashForumOpen")} value={s.forum_open_total} sub={t("dashForumOpenSub")} to="/forum?sort=unanswered" warn={s.forum_open_total > 0} />
        <Tile label={t("dashReviews")} value={s.reviews} sub={t("dashReviewsSub")} delta={vs(s.reviews, p.reviews)} />
        <Tile label={t("dashModeration")} value={pending} sub={t("dashModerationSub")} onClick={() => onOpenSection("moderation")} warn={pending > 0} />
      </div>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-primary">{t("dashChartTitle")}</h2>
        <DailyChart daily={data.daily} />
      </Card>

      {/* Two independent columns (CSS columns), so a short list leaves no gap under it
          next to a long one; each card stays whole (break-inside-avoid in ListCard). */}
      <div className="gap-4 lg:columns-2 [&>*]:mb-4">
        <ListCard icon={<MessagesSquare className="h-4 w-4" />} title={t("dashTopQuestions")} hint={t("dashTopHint")}
          more={() => onOpenSection("chat")}>
          {data.top_questions.map((q, i) => (
            <Row key={i}
              main={q.question}
              sub={`${plural(q.students, "insightsStudents")} · ${plural(q.asks, "dashTimes")} · ${formatRelativeTime(q.last_at, locale)}`}
              action={<MakeFaq onClick={() => onMakeFaq(insightToFaqDraft({ question: q.question, students: q.students, at: q.last_at }, "frequent"))} />}
            />
          ))}
        </ListCard>
        <ListCard icon={<MessageCircleQuestion className="h-4 w-4" />} title={t("dashUnanswered")} hint={t("dashUnansweredHint")}
          more={() => onOpenSection("chat")}>
          {data.unanswered.map((q, i) => (
            <Row key={i}
              main={q.question || "—"}
              sub={`${q.context ? `${t("insightsEarlier")}: ${q.context} · ` : ""}${formatRelativeTime(q.at, locale)}`}
              action={q.question ? <MakeFaq onClick={() => onMakeFaq(insightToFaqDraft(q, "unanswered"))} /> : null}
            />
          ))}
        </ListCard>
        <ListCard icon={<ThumbsDown className="h-4 w-4" />} title={t("dashDisliked")} hint={t("dashDislikedHint")}
          more={() => onOpenSection("chat")}>
          {data.disliked.map((q, i) => (
            <Row key={i}
              main={q.question || "—"}
              sub={`${q.answer ? `AI: ${q.answer} · ` : ""}${formatRelativeTime(q.at, locale)}`}
              action={q.question ? <MakeFaq onClick={() => onMakeFaq(insightToFaqDraft(q, "disliked"))} /> : null}
            />
          ))}
        </ListCard>
        <ListCard icon={<GraduationCap className="h-4 w-4" />} title={t("dashCourses")} hint={t("dashCoursesHint")}>
          {data.top_courses.map((c) => (
            <Row key={c.code}
              main={<Link to={`/courses/${courseSlug(c.code)}`} viewTransition className="hover:underline">{c.code} · {c.name}</Link>}
              sub={plural(c.questions, "dashQuestions")}
            />
          ))}
        </ListCard>
        <ListCard icon={<MessageCircleQuestion className="h-4 w-4" />} title={t("dashOpenThreads")} hint={t("dashOpenThreadsHint")}>
          {data.open_threads.map((o) => (
            <Row key={o.id}
              main={<Link to={`/forum/${o.id}`} viewTransition className="hover:underline">{o.title}</Link>}
              sub={formatRelativeTime(o.created_at, locale)}
            />
          ))}
        </ListCard>
      </div>
    </div>
  );
}

/** A number with its label; a link or a button when there is somewhere to go. */
function Tile({ label, value, sub, to, onClick, warn, delta, deltaLabel }: {
  label: string;
  value: ReactNode;
  sub: string;
  to?: string;
  onClick?: () => void;
  warn?: boolean;
  /** The comparison with the previous period (a <Delta>). */
  delta?: ReactNode;
  /** What the comparison is about when it isn't the big number (e.g. "👎"). */
  deltaLabel?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-semibold text-label">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-primary">{value}</p>
      <p className={cn("mt-0.5 flex items-center gap-0.5 text-xs", warn ? "text-amber-800 dark:text-amber-700" : "text-label")}>
        {sub}
        {to || onClick ? <ChevronRight className="h-3 w-3 shrink-0" aria-hidden /> : null}
      </p>
      {delta ? <p className="mt-1 text-[11px] text-label">{deltaLabel ? `${deltaLabel} ` : ""}{delta}</p> : null}
    </>
  );
  const box = "block h-full rounded-2xl border border-border/60 bg-surface p-3 text-left shadow-sm";
  if (to) return <Link to={to} viewTransition className={cn(box, "hover:bg-background-2")}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cn(box, "w-full hover:bg-background-2")}>{body}</button>;
  return <div className={box}>{body}</div>;
}

/**
 * Compared with the same number of days before: "↑ 35% vs the previous 7
 * days". Neutral grey, except for numbers where up is bad (👎): amber up,
 * green down. Nothing when both periods are 0.
 */
function Delta({ now, before, days, badWhenUp }: { now: number; before: number; days: number; badWhenUp?: boolean }) {
  const { t } = useLocale();
  if (now === 0 && before === 0) return null;
  if (now === before) return <>{fill(t("dashVsPrevSame"), { n: days })}</>;
  const up = now > before;
  const text = before === 0 ? fill(t("dashVsPrevFromZero"), { n: days }) : fill(t("dashVsPrev"), { arrow: up ? "↑" : "↓", pct: Math.round((100 * Math.abs(now - before)) / before), n: days });
  return (
    <span className={cn(badWhenUp && (up ? "text-amber-800 dark:text-amber-700" : "text-green-700"))}>{text}</span>
  );
}

/**
 * Today's calls to the AI (chat answers, moderation of new posts and reviews,
 * review summaries) against the provider's free quota, as one bar split by
 * kind. Without a quota set (AI_DAILY_QUOTA=0, e.g. a laptop with Ollama)
 * just the counts.
 */
function AIQuota({ data }: { data: Dashboard }) {
  const { t } = useLocale();
  const c = data.ai_calls_today;
  const parts = [
    { key: "chat", label: t("dashCallsChat"), n: c.chat, color: "var(--color-chart-ai)" },
    { key: "moderation", label: t("dashCallsModeration"), n: c.moderation, color: "var(--color-chart-faq)" },
    { key: "summary", label: t("dashCallsSummary"), n: c.summary, color: "var(--color-chart-none)" },
  ];
  const used = c.chat + c.moderation + c.summary;
  const quota = data.ai_quota;
  const share = quota > 0 ? used / quota : 0;
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-primary">
          <Cpu className="h-4 w-4" />
          {t("dashCallsTitle")}
        </h2>
        <p className="text-sm tabular-nums text-primary">
          {quota > 0 ? fill(t("dashCallsOfQuota"), { n: used, quota, pct: pct(used, quota) }) : fill(t("dashCallsNoQuota"), { n: used })}
        </p>
      </div>
      {quota > 0 ? (
        <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-background-2" role="img"
          aria-label={fill(t("dashCallsOfQuota"), { n: used, quota, pct: pct(used, quota) })}>
          {parts.map((part) =>
            // At least 4px, so even 1 call of 1000 shows.
            part.n > 0 ? <span key={part.key} style={{ width: `${Math.min(100, (100 * part.n) / quota)}%`, minWidth: 4, background: part.color }} /> : null,
          )}
        </div>
      ) : null}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-label">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: part.color }} aria-hidden />
            {part.label}: <span className="font-semibold tabular-nums text-primary">{part.n}</span>
          </li>
        ))}
      </ul>
      {quota > 0 && share >= 0.8 ? (
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-700" role="status">{t("dashCallsNearLimit")}</p>
      ) : (
        <p className="text-xs text-label">{quota > 0 ? t("dashCallsHint") : t("dashCallsHintNoQuota")}</p>
      )}
    </Card>
  );
}

function ListCard({ icon, title, hint, more, children }: {
  icon: ReactNode;
  title: string;
  hint: string;
  more?: () => void;
  children: ReactNode[];
}) {
  const { t } = useLocale();
  return (
    <Card className="space-y-2 break-inside-avoid">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-primary">{icon}{title}</h2>
          <p className="text-xs text-label">{hint}</p>
        </div>
        {more ? (
          <button type="button" onClick={more} className="shrink-0 text-xs font-semibold text-brand hover:underline dark:text-primary">
            {t("dashSeeAll")}
          </button>
        ) : null}
      </div>
      {children.length > 0 ? (
        <ul className="divide-y divide-border/60">{children}</ul>
      ) : (
        <p className="py-2 text-sm text-label">{t("dashEmpty")}</p>
      )}
    </Card>
  );
}

function Row({ main, sub, action }: { main: ReactNode; sub: string; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-primary">{main}</p>
        <p className="truncate text-xs text-label">{sub}</p>
      </div>
      {action}
    </li>
  );
}

function MakeFaq({ onClick }: { onClick: () => void }) {
  const { t } = useLocale();
  return (
    <Button size="sm" variant="ghost" onClick={onClick} title={t("insightsMakeFaq")} className="shrink-0">
      <BookPlus className="h-4 w-4" />
      <span className="hidden sm:inline">{t("insightsMakeFaq")}</span>
    </Button>
  );
}

const SERIES: { key: keyof Omit<DashboardDay, "day">; label: TranslationKey; color: string }[] = [
  { key: "answered", label: "dashLegendAi", color: "var(--color-chart-ai)" },
  { key: "faq", label: "dashLegendFaq", color: "var(--color-chart-faq)" },
  { key: "unanswered", label: "dashLegendNone", color: "var(--color-chart-none)" },
];

/** A round step for the top of the scale: 1, 2, 5, 10, 20, 50… */
function niceMax(n: number) {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= n) ?? 10 * p;
}

/**
 * Stacked bars, one per day: answered by the AI, from the FAQ, no answer
 * (bottom to top, 2px gaps between parts, rounded top). Hover or focus a day
 * for its numbers; the legend carries the period's totals, and the same data
 * is available as a table.
 */
function DailyChart({ daily }: { daily: DashboardDay[] }) {
  const { t, locale } = useLocale();
  const [hover, setHover] = useState<number | null>(null);
  const totals = SERIES.map((sr) => daily.reduce((n, d) => n + d[sr.key], 0));
  const max = niceMax(Math.max(0, ...daily.map((d) => d.answered + d.faq + d.unanswered)));
  const intl = locale === "kz" ? "kk" : locale;
  const dayLabel = (iso: string, long = false) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(intl, long ? { weekday: "short", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
  // Dates under the bars: about 7 on a computer, 3 on a phone (more would run into each other).
  const labelEvery = Math.ceil(daily.length / (useIsPhone() ? 3 : 7));
  const shown = hover !== null ? daily[hover] : null;

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-label">
        {SERIES.map((sr, i) => (
          <li key={sr.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: sr.color }} aria-hidden />
            {t(sr.label)}: <span className="font-semibold text-primary">{totals[i]}</span>
          </li>
        ))}
      </ul>

      <div className="relative">
        {/* Gridlines with their values: recessive, behind the bars. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40" aria-hidden>
          {[1, 0.5, 0].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-border/50" style={{ top: `${(1 - f) * 100}%` }}>
              <span className="absolute -top-2 left-0 bg-surface pr-1 text-[10px] tabular-nums text-label">{Math.round(max * f)}</span>
            </div>
          ))}
        </div>
        <div className="ml-7 flex h-40 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {daily.map((d, i) => {
            const total = d.answered + d.faq + d.unanswered;
            return (
              <button
                key={d.day}
                type="button"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${dayLabel(d.day, true)}: ${SERIES.map((sr) => `${t(sr.label)} ${d[sr.key]}`).join(", ")}`}
                className={cn("flex h-full min-w-0 flex-1 flex-col justify-end rounded-t outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  hover === i && "bg-background-2/70")}
              >
                {/* flex-col-reverse: the first series (AI answers) sits at the bottom, "no answer" on top. */}
                <span className="mx-auto flex w-full max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t" style={{ height: `${(total / max) * 100}%` }}>
                  {SERIES.map((sr) =>
                    d[sr.key] > 0 ? <span key={sr.key} className="w-full" style={{ flexGrow: d[sr.key], flexBasis: 0, minHeight: 2, background: sr.color }} /> : null,
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {shown ? (
          <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-lg" role="status">
            <p className="font-semibold text-primary">{dayLabel(shown.day, true)}</p>
            {SERIES.map((sr) => (
              <p key={sr.key} className="flex items-center gap-1.5 text-label">
                <span className="h-2 w-2 rounded-sm" style={{ background: sr.color }} aria-hidden />
                {t(sr.label)}: <span className="font-semibold tabular-nums text-primary">{shown[sr.key]}</span>
              </p>
            ))}
          </div>
        ) : null}
        <div className="ml-7 mt-1 flex gap-[2px] text-[10px] text-label" aria-hidden>
          {daily.map((d, i) => (
            <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
              {i % labelEvery === 0 || i === daily.length - 1 ? dayLabel(d.day) : ""}
            </span>
          ))}
        </div>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer font-semibold text-label hover:text-primary">{t("dashShowTable")}</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-label">
            <tr>
              <th className="py-1 font-semibold">{t("dashDay")}</th>
              {SERIES.map((sr) => <th key={sr.key} className="py-1 font-semibold">{t(sr.label)}</th>)}
            </tr>
          </thead>
          <tbody className="text-primary">
            {[...daily].reverse().map((d) => (
              <tr key={d.day} className="border-t border-border/50">
                <td className="py-1">{dayLabel(d.day, true)}</td>
                {SERIES.map((sr) => <td key={sr.key} className="py-1">{d[sr.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
