import { useAuth } from "@/app/AuthContext";
import {
  isStaffRole,
  useModerationQueue,
  useReviewModerationItem,
  type ModerationItem,
  type QueueStatus,
} from "@/features/moderation/api";
import { useCategoryLabel } from "@/features/moderation/components/ModerationNoticeCard";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { getErrorMessage } from "@/shared/api/client";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { useState } from "react";
import { Link } from "react-router-dom";

const TABS: { status: QueueStatus; key: "moderationPending" | "moderationApproved" | "moderationRejected" }[] = [
  { status: "pending", key: "moderationPending" },
  { status: "approved", key: "moderationApproved" },
  { status: "rejected", key: "moderationRejected" },
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
            className="w-full rounded-xl border border-border bg-white px-3.5 py-2 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
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

export function ModerationPage() {
  const { user } = useAuth();
  const { t } = useLocale();
  const [status, setStatus] = useState<QueueStatus>("pending");
  const queue = useModerationQueue(status);

  if (!isStaffRole(user?.role)) {
    return <p className="mx-auto max-w-3xl text-sm text-label">{t("moderationNoAccess")}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold text-primary">{t("moderationTitle")}</h1>
      <div className="flex gap-2" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            type="button"
            role="tab"
            aria-selected={status === tab.status}
            onClick={() => setStatus(tab.status)}
            className={cn(
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              status === tab.status ? "bg-primary text-white" : "bg-white text-primary hover:bg-background-2",
            )}
          >
            {t(tab.key)}
            {tab.status === "pending" && queue.data ? ` (${queue.data.pending})` : ""}
          </button>
        ))}
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
