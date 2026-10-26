import { RestrictionsSection } from "@/features/moderation/components/Restrictions";
import { useAuth } from "@/app/AuthContext";
import {
  isStaffRole,
  useModerationQueue,
  usePendingModerationCount,
  useReviewModerationItem,
  type ModerationItem,
  type QueueDateRange,
  type QueueSort,
  type QueueStatus,
} from "@/features/moderation/api";
import { useCategoryLabel } from "@/features/moderation/components/ModerationNoticeCard";
import { FaqEditor } from "@/features/faq/components/FaqEditor";
import { ChatInsightsSection } from "@/features/chat/components/ChatInsightsSection";
import { ReportsSection } from "@/features/moderation/components/ReportsSection";
import { useReports } from "@/features/moderation/reports";
import type { FaqDraft } from "@/features/faq/api";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { getErrorMessage } from "@/shared/api/client";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const TABS: {
  status: QueueStatus;
  key: "moderationPending" | "moderationApproved" | "moderationRejected" | "moderationAll";
}[] = [
  { status: "pending", key: "moderationPending" },
  { status: "approved", key: "moderationApproved" },
  { status: "rejected", key: "moderationRejected" },
  { status: "all", key: "moderationAll" },
];

function ModerationCard({ item }: { item: ModerationItem }) {
  const { t } = useLocale();
  const categoryLabel = useCategoryLabel();
  const review = useReviewModerationItem();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const blocked = item.decision === "block";

  async function decide(action: "approve" | "reject") {
    setError(undefined);
    try {
      await review.mutateAsync({ id: item.id, action, note });
    } catch (err) {
      setError(getErrorMessage(err) ?? t("moderationActionFailed"));
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 font-semibold",
            blocked ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800",
          )}
        >
          {blocked ? t("moderationAiBlock") : t("moderationAiReview")}
        </span>
        {item.categories.map((c) => (
          <span key={c} className="rounded-full bg-background-2 px-2.5 py-1 font-medium text-primary">
            {categoryLabel(c)}
          </span>
        ))}
        <span className="rounded-full bg-background-2 px-2.5 py-1 font-medium text-primary">
          {item.kind === "thread" ? t("moderationQuestion") : t("moderationAnswer")}
        </span>
        <span className="ml-auto text-label">
          {item.authorName} · {new Date(item.createdAt).toLocaleString()}
        </span>
      </div>

      <p className="text-xs text-label">
        {item.hiddenAfterPublish ? t("moderationWasPublished") : t("moderationStoppedBefore")}
        {item.reason === "moderation_unavailable" ? ` · ${t("moderationAiUnavailable")}` : ""}
      </p>

      {item.kind === "comment" && item.threadId ? (
        <p className="text-xs text-label">
          {t("moderationInThread")}:{" "}
          <Link to={`/forum/${item.threadId}`} className="font-medium text-primary underline-offset-2 hover:underline">
            {item.threadTitle || `#${item.threadId}`}
          </Link>
        </p>
      ) : null}

      <div className="space-y-1 text-sm text-primary">
        {item.title ? <p className="font-semibold">{item.title}</p> : null}
        <p className="whitespace-pre-wrap break-words">{item.body}</p>
      </div>

      {item.status === "pending" ? (
        <div className="space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={t("moderationNotePlaceholder")}
            aria-label={t("moderationNotePlaceholder")}
            className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" disabled={review.isPending} onClick={() => void decide("approve")}>
              {t("moderationApprove")}
            </Button>
            <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => void decide("reject")}>
              {t("moderationReject")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1 text-xs text-label">
          <p>
            {t("moderationReviewedBy")}: {item.reviewerName ?? "—"}
            {item.reviewedAt ? ` · ${new Date(item.reviewedAt).toLocaleString()}` : ""}
          </p>
          {item.adminNote ? <p className="whitespace-pre-wrap">“{item.adminNote}”</p> : null}
          {item.publishedThreadId ? (
            <Link
              to={`/forum/${item.publishedThreadId}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t("moderationViewPublished")}
            </Link>
          ) : item.status === "approved" && item.threadId ? (
            <Link
              to={`/forum/${item.threadId}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t("moderationViewPublished")}
            </Link>
          ) : null}
        </div>
      )}
    </Card>
  );
}

const SECTIONS = [
  { id: "moderation", key: "adminSectionModeration" },
  { id: "reports", key: "adminSectionReports" },
  { id: "faq", key: "adminSectionFaq" },
  { id: "chat", key: "adminSectionChat" },
  { id: "restrictions", key: "adminSectionRestrictions" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** The admin panel: moderation queue, FAQ editor (?section=faq), AI chat questions (?section=chat). */
export function ModerationPage() {
  const { user } = useAuth();
  const { t } = useLocale();
  const [params, setParams] = useSearchParams();
  const section: SectionId = SECTIONS.find((x) => x.id === params.get("section"))?.id ?? "moderation";
  const [faqDraft, setFaqDraft] = useState<FaqDraft>();
  const openSection = (id: SectionId) => setParams(id === "moderation" ? {} : { section: id }, { replace: true });
  const pending = usePendingModerationCount().data ?? 0;
  const openReports = useReports("open", isStaffRole(user?.role)).data?.total ?? 0;

  if (!isStaffRole(user?.role)) {
    return <p className="mx-auto max-w-3xl text-sm text-label">{t("moderationNoAccess")}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold text-primary">{t("adminPanel")}</h1>
      <nav className="flex gap-1 border-b border-border/60" aria-label={t("adminPanel")}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={section === s.id ? "page" : undefined}
            onClick={() => openSection(s.id)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
              section === s.id ? "border-primary text-primary" : "border-transparent text-label hover:text-primary",
            )}
          >
            {t(s.key)}
            {(s.id === "moderation" ? pending : s.id === "reports" ? openReports : 0) > 0 ? (
              <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">
                {s.id === "moderation" ? pending : openReports}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      {section === "faq" ? (
        <FaqEditor initialDraft={faqDraft} onDraftUsed={() => setFaqDraft(undefined)} />
      ) : section === "reports" ? (
        <ReportsSection />
      ) : section === "restrictions" ? (
        <RestrictionsSection />
      ) : section === "chat" ? (
        <ChatInsightsSection
          onMakeFaq={(draft) => {
            setFaqDraft(draft);
            openSection("faq");
          }}
        />
      ) : (
        <ModerationSection />
      )}
    </div>
  );
}

function ModerationSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<QueueStatus>("pending");
  const [range, setRange] = useState<QueueDateRange>({});
  const [sort, setSort] = useState<QueueSort>("new");
  const queue = useModerationQueue(status, range, sort);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-label">{t("moderationTitle")}</h2>
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            type="button"
            role="tab"
            aria-selected={status === tab.status}
            onClick={() => setStatus(tab.status)}
            className={cn(
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              status === tab.status ? "bg-brand text-white" : "bg-surface text-primary hover:bg-background-2",
            )}
          >
            {t(tab.key)}
            {tab.status === "pending" && queue.data ? ` (${queue.data.pending})` : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        {(["from", "to"] as const).map((key) => (
          <label key={key} className="flex flex-col gap-1 text-xs font-medium text-label">
            {key === "from" ? t("moderationFrom") : t("moderationTo")}
            <input
              type="date"
              value={range[key] ?? ""}
              onChange={(e) => setRange((r) => ({ ...r, [key]: e.target.value || undefined }))}
              className="h-9 rounded-xl border border-border bg-surface px-3 text-sm text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </label>
        ))}
        <div className="ml-auto flex rounded-lg bg-background-2 p-0.5 text-xs font-semibold" role="group" aria-label={t("moderationSortLabel")}>
          {(["new", "old"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={sort === value}
              onClick={() => setSort(value)}
              className={cn(
                "rounded-md px-3 py-1.5",
                sort === value ? "bg-surface text-primary shadow-sm" : "text-label hover:text-primary",
              )}
            >
              {value === "new" ? t("moderationSortNew") : t("moderationSortOld")}
            </button>
          ))}
        </div>
        {range.from || range.to ? (
          <Button size="sm" variant="ghost" onClick={() => setRange({})}>
            {t("moderationClearDates")}
          </Button>
        ) : null}
      </div>

      {queue.isLoading ? <p className="text-sm text-label">{t("loading")}</p> : null}
      {queue.isError ? <p className="text-sm text-red-600">{t("moderationLoadFailed")}</p> : null}
      {queue.data && queue.data.items.length === 0 ? (
        <p className="text-sm text-label">{t("moderationEmpty")}</p>
      ) : null}
      <div className="space-y-3">
        {queue.data?.items.map((item) => <ModerationCard key={item.id} item={item} />)}
      </div>
    </div>
  );
}
