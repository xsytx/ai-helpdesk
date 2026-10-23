import { AnswerList } from "@/features/forum/components/AnswerList";
import { HiddenPostNotice } from "@/features/moderation/components/HiddenPostNotice";
import { ReplyForm } from "@/features/forum/components/ReplyForm";
import { useAnswers, useFollowThread, useThread, useThreadSubscribed } from "@/features/forum/api";
import { useAuth } from "@/app/AuthContext";
import { Bell, BellOff } from "lucide-react";
import { DeleteConfirm, PostActionErrorText, PostMenu, usePostPermissions } from "@/features/forum/components/PostMenu";
import { TagChip, TagInput } from "@/features/forum/components/TagInput";
import { ReportDialog } from "@/features/forum/components/ReportDialog";
import { postActionError, useDeleteThread, useUpdateThread, type PostActionError } from "@/features/forum/postActions";
import type { Thread } from "@/entities/forum";
import { Button } from "@/shared/ui/Button";
import { useState } from "react";
import { useLocale } from "@/i18n/LocaleContext";
import { formatRelativeTime } from "@/shared/lib/format";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { Card } from "@/shared/ui/Card";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

export function ThreadDetailPage() {
  const { threadId = "" } = useParams();
  const { t } = useLocale();
  const { data: thread, isLoading, isError } = useThread(threadId);
  const answersQuery = useAnswers(threadId);
  const answers = answersQuery.data ?? [];
  // Placeholder data (the thread from the list) has no answers yet.
  const answersLoading = answersQuery.isLoading || answersQuery.isPlaceholderData;

  if (isLoading) {
    return <p className="text-sm text-label">{t("loading")}</p>;
  }

  if (isError || !thread) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <p className="text-sm text-error">{t("threadNotFound")}</p>
          <Link viewTransition to="/forum" className="mt-3 inline-block text-sm font-medium text-primary-light">
            ← {t("backToForum")}
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        viewTransition
        to="/forum"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary-light hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToForum")}
      </Link>

      <ThreadCardFull thread={thread} />

      <Card>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-primary">
            {t("answers")} ({thread.answerCount})
          </h2>
          <p className="text-xs text-label">{t("sortedByLikes")}</p>
        </div>
        {answersLoading ? (
          <p className="mt-4 text-sm text-label">{t("loading")}</p>
        ) : (
          <div className="mt-4">
            <AnswerList
              threadId={threadId}
              answers={answers}
              threadAuthorId={thread.authorId}
              acceptedAnswerId={thread.acceptedAnswerId}
            />
          </div>
        )}
      </Card>

      <Card>
        <ReplyForm threadId={threadId} />
      </Card>
    </div>
  );
}

/** The question itself: text, tags, and for its author (or an admin) edit/delete. */
function ThreadCardFull({ thread }: { thread: Thread }) {
  const { locale, t } = useLocale();
  const navigate = useNavigate();
  const { canEdit, canDelete, canReport } = usePostPermissions(thread.authorId);
  const [reporting, setReporting] = useState(false);
  const update = useUpdateThread(thread.id);
  const remove = useDeleteThread(thread.id);
  const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");
  const [draft, setDraft] = useState({ title: "", body: "", tags: [] as string[] });
  const [error, setError] = useState<PostActionError>();
  const tags = thread.tags ?? [];

  function startEdit() {
    setDraft({ title: thread.title, body: thread.body, tags });
    setError(undefined);
    setMode("edit");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (draft.title.trim().length < 5 || draft.body.trim().length < 10) return;
    setError(undefined);
    try {
      await update.mutateAsync({ title: draft.title.trim(), body: draft.body.trim(), tags: draft.tags });
      setMode("view");
    } catch (err) {
      setError(postActionError(err));
    }
  }

  async function confirmDelete() {
    setError(undefined);
    try {
      await remove.mutateAsync();
      navigate("/forum", { replace: true, viewTransition: true });
    } catch (err) {
      setError(postActionError(err));
    }
  }

  return (
    <Card>
      {reporting ? <ReportDialog target={{ kind: "thread", id: thread.id }} onClose={() => setReporting(false)} /> : null}
      <div className="flex gap-3">
        <UserAvatar userId={thread.authorId} name={thread.authorName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-label">
              {thread.authorName} · {formatRelativeTime(thread.createdAt, locale)}
            </p>
            <div className="flex items-center gap-1">
              <FollowButton threadId={thread.id} />
              {mode === "view" ? (
                <PostMenu
                  canEdit={canEdit}
                  canDelete={canDelete}
                  canReport={canReport}
                  onEdit={startEdit}
                  onDelete={() => setMode("confirmDelete")}
                  onReport={() => setReporting(true)}
                />
              ) : null}
            </div>
          </div>
          <HiddenPostNotice status={thread.moderationStatus} authorId={thread.authorId} className="my-2" />
          {mode === "edit" ? (
            <form className="mt-2 space-y-3" onSubmit={save}>
              <input
                aria-label={t("threadTitle")}
                value={draft.title}
                maxLength={120}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="h-11 w-full rounded-xl border border-border px-3.5 text-base font-bold text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              />
              <textarea
                aria-label={t("threadDetails")}
                value={draft.body}
                rows={5}
                maxLength={2000}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                className="w-full resize-y rounded-xl border border-border px-3.5 py-2.5 text-sm text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              />
              <TagInput id={`edit-tags-${thread.id}`} tags={draft.tags} onChange={(tags) => setDraft((d) => ({ ...d, tags }))} />
              {draft.title.trim().length < 5 ? <p className="text-xs text-error">{t("threadTitleTooShort")}</p> : null}
              {draft.body.trim().length < 10 ? <p className="text-xs text-error">{t("threadBodyTooShort")}</p> : null}
              <PostActionErrorText error={error} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={update.isPending}>
                  {t("save")}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setMode("view")}>
                  {t("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <h1 className="mt-1 text-xl font-bold text-primary">{thread.title}</h1>
              <p className="mt-2 whitespace-pre-wrap text-sm text-primary/90">{thread.body}</p>
              {tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Link key={tag} viewTransition to={`/forum?tag=${encodeURIComponent(tag)}`} className="hover:opacity-80">
                      <TagChip tag={tag} />
                    </Link>
                  ))}
                </div>
              ) : null}
              {mode === "confirmDelete" ? (
                <DeleteConfirm
                  messageKey="deleteThreadConfirm"
                  busy={remove.isPending}
                  onConfirm={() => void confirmDelete()}
                  onCancel={() => setMode("view")}
                />
              ) : null}
              <PostActionErrorText error={error} />
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Follow the question: a notification for every new answer. */
function FollowButton({ threadId }: { threadId: string }) {
  const { t } = useLocale();
  const { user } = useAuth();
  const subscribed = useThreadSubscribed(threadId).data;
  const follow = useFollowThread(threadId);
  if (!user || subscribed === undefined) return null;
  return (
    <button
      type="button"
      aria-pressed={subscribed}
      onClick={() => follow.mutate(!subscribed)}
      title={subscribed ? t("unfollowThreadHint") : t("followThreadHint")}
      className={
        subscribed
          ? "inline-flex items-center gap-1 rounded-lg bg-background-2 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-background-2-hover"
          : "inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-background-2"
      }
    >
      {subscribed ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
      {subscribed ? t("unfollowThread") : t("followThread")}
    </button>
  );
}
