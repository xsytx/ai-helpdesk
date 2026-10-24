import { PostEditor } from "./PostEditor";
import { RichText } from "@/shared/ui/RichText";
import type { Answer } from "@/entities/forum";
import { useAuth } from "@/app/AuthContext";
import { useAcceptAnswer, useLikeAnswer } from "@/features/forum/api";
import { cn } from "@/shared/lib/cn";
import { CheckCircle2, Reply } from "lucide-react";
import { ReplyForm, type ReplyTarget } from "./ReplyForm";
import { useLocale } from "@/i18n/LocaleContext";
import { formatRelativeTime } from "@/shared/lib/format";
import { HiddenPostNotice } from "@/features/moderation/components/HiddenPostNotice";
import { slideFromPrevious } from "@/shared/lib/motion";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/Button";
import { postActionError, useDeleteAnswer, useUpdateAnswer, type PostActionError } from "../postActions";
import { DeleteConfirm, PostActionErrorText, PostMenu, usePostPermissions } from "./PostMenu";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { LikeButton } from "./LikeButton";
import { ReportDialog } from "./ReportDialog";
import { PhotoEditor, PhotoGallery } from "./Photos";
import { forumKeys, MAX_ANSWER_PHOTOS, uploadAnswerPhoto } from "../api";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LevelBadge } from "@/features/reputation/components/LevelBadge";

/**
 * The answers, most liked first; the one the question's author marked as
 * the solution goes on top. The author can mark or unmark it on any answer.
 * Replies (one level) sit under their answer, oldest first; "Reply" opens a
 * small box there that starts with @author. Replies can be liked and marked
 * as the solution too (a correct reply under a wrong answer): then that
 * answer goes on top and the reply is marked.
 */
export function AnswerList({
  threadId,
  answers: byLikes,
  threadAuthorId,
  acceptedAnswerId,
}: {
  threadId: string;
  answers: Answer[];
  threadAuthorId?: string;
  acceptedAnswerId?: string;
}) {
  const { user } = useAuth();
  const { locale, t } = useLocale();
  const likeAnswer = useLikeAnswer(threadId);
  const accept = useAcceptAnswer(threadId);
  const isAuthor = Boolean(user && threadAuthorId && user.id === threadAuthorId);
  const [replying, setReplying] = useState<{ rootId: string; target: ReplyTarget } | null>(null);
  // A reply whose answer is hidden (held by moderation) is shown as an answer.
  const ids = new Set(byLikes.map((a) => a.id));
  const isReply = (a: Answer) => Boolean(a.parentId && ids.has(a.parentId));
  const topLevel = byLikes.filter((a) => !isReply(a));
  const repliesOf = new Map<string, Answer[]>();
  for (const a of [...byLikes].filter(isReply).sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    repliesOf.set(a.parentId!, [...(repliesOf.get(a.parentId!) ?? []), a]);
  }
  const solution = byLikes.find((a) => a.id === acceptedAnswerId);
  // The answer with the solution in it (itself, or one of its replies) goes on top.
  const accepted = solution && isReply(solution) ? topLevel.find((a) => a.id === solution.parentId) : solution;
  const answers = accepted ? [accepted, ...topLevel.filter((a) => a !== accepted)] : topLevel;
  const replyTo = (rootId: string, a: Answer) =>
    user ? () => setReplying({ rootId, target: { answerId: rootId, authorId: a.authorId, authorName: a.authorName } }) : undefined;

  const likeButton = (a: Answer) => {
    const liked = user ? a.likedByUserIds.includes(user.id) : false;
    return (
      <LikeButton
        likes={a.likes}
        active={liked}
        disabled={!user}
        busy={likeAnswer.isPending}
        label={liked ? t("unlikeAnswer") : t("likeAnswer")}
        onClick={() => {
          if (!user) return;
          likeAnswer.mutate({ answerId: a.id, userId: user.id, scoreBefore: a.likes });
        }}
      />
    );
  };

  // The question's author marks (or unmarks) the solution: an answer or a reply.
  const acceptButton = (a: Answer) => {
    if (!isAuthor || a.moderationStatus === "held" || a.moderationStatus === "rejected") return null;
    const isSolution = a === solution;
    return (
      <button
        type="button"
        aria-pressed={isSolution}
        disabled={accept.isPending}
        onClick={() => accept.mutate({ answerId: isSolution ? null : a.id, previous: acceptedAnswerId })}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-60",
          isSolution ? "text-label hover:bg-background-2" : "text-green-700 hover:bg-green-50",
        )}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {isSolution ? t("unmarkSolution") : t("markSolution")}
      </button>
    );
  };

  // When likes reorder the answers, slide each one from its old spot.
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const lastPositions = useRef(new Map<string, number>());
  const lastOrder = useRef("");
  const order = answers.map((a) => a.id).join(",");
  // Runs after every render so the saved positions are never stale.
  useLayoutEffect(() => {
    if (lastOrder.current && lastOrder.current !== order) {
      slideFromPrevious(itemRefs.current, lastPositions.current);
    }
    lastOrder.current = order;
    lastPositions.current = new Map(
      [...itemRefs.current].map(([id, el]) => [id, el.offsetTop]),
    );
  });

  if (answers.length === 0) {
    return <p className="text-sm text-label">{t("noAnswersYet")}</p>;
  }

  return (
    <ul className="space-y-4">
      {answers.map((answer, index) => {
        const isSolution = answer === solution;
        return (
          <li
            key={answer.id}
            ref={(el) => {
              if (el) itemRefs.current.set(answer.id, el);
              else itemRefs.current.delete(answer.id);
            }}
            className={cn(
              "flex gap-3 rounded-xl border bg-surface p-3",
              isSolution ? "border-green-300 ring-1 ring-green-200" : "border-border/50",
            )}
          >
            <div className="flex flex-col items-center gap-1 pt-1">
              {likeButton(answer)}
              {isSolution ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  {t("solution")}
                </span>
              ) : index === 0 && !accepted ? (
                <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
                  {t("topAnswer")}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <AnswerContent
                threadId={threadId}
                answer={answer}
                locale={locale}
                onReply={replyTo(answer.id, answer)}
                actions={acceptButton(answer)}
              />
              {repliesOf.get(answer.id)?.length ? (
                <ul className="mt-3 space-y-3 border-l-2 border-border/60 pl-3">
                  {repliesOf.get(answer.id)!.map((r) => (
                    <li
                      key={r.id}
                      className={cn(r === solution && "-ml-1 rounded-lg border border-green-300 p-2 ring-1 ring-green-200")}
                    >
                      {r === solution ? (
                        <span className="mb-1 inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          {t("solution")}
                        </span>
                      ) : null}
                      <AnswerContent
                        threadId={threadId}
                        answer={r}
                        locale={locale}
                        compact
                        onReply={replyTo(answer.id, r)}
                        actions={
                          <>
                            {likeButton(r)}
                            {acceptButton(r)}
                          </>
                        }
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
              {replying?.rootId === answer.id ? (
                <ReplyForm
                  // A new box for each person replied to (it starts with their @name).
                  key={`${replying.target.authorId}-${replying.target.authorName}`}
                  threadId={threadId}
                  replyTo={replying.target}
                  onDone={() => setReplying(null)}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AnswerContent({
  threadId,
  answer,
  locale,
  compact = false,
  onReply,
  actions,
}: {
  threadId: string;
  answer: Answer;
  locale: string;
  /** A reply: smaller avatar. */
  compact?: boolean;
  onReply?: () => void;
  /** More buttons next to "Reply" (like, mark as the solution). */
  actions?: ReactNode;
}) {
  const { t } = useLocale();
  const { canEdit, canDelete, canReport } = usePostPermissions(answer.authorId);
  const [reporting, setReporting] = useState(false);
  const update = useUpdateAnswer(threadId);
  const qc = useQueryClient();
  const remove = useDeleteAnswer(threadId);
  const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");
  const [body, setBody] = useState("");
  const [error, setError] = useState<PostActionError>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(undefined);
    try {
      await update.mutateAsync({ answerId: answer.id, body: body.trim() });
      setMode("view");
    } catch (err) {
      setError(postActionError(err));
    }
  }

  async function confirmDelete() {
    setError(undefined);
    try {
      await remove.mutateAsync(answer.id);
    } catch (err) {
      setError(postActionError(err));
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <Link viewTransition to={`/users/${answer.authorId}`} aria-label={answer.authorName} className="shrink-0">
          <UserAvatar
            userId={answer.authorId}
            name={answer.authorName}
            avatar={answer.authorAvatar}
            className={compact ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-[10px]"}
          />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-primary">
            <Link viewTransition to={`/users/${answer.authorId}`} className="hover:underline">
              {answer.authorName}
            </Link>
            <LevelBadge level={answer.authorLevel} points={answer.authorPoints} hideNewcomer />
          </p>
          <p className="text-xs text-label">{formatRelativeTime(answer.createdAt, locale)}</p>
        </div>
        {mode === "view" ? (
          <PostMenu
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={() => {
              setBody(answer.body);
              setError(undefined);
              setMode("edit");
            }}
            onDelete={() => setMode("confirmDelete")}
            canReport={canReport}
            onReport={() => setReporting(true)}
          />
        ) : null}
      </div>
      {reporting ? <ReportDialog target={{ kind: "comment", id: answer.id }} onClose={() => setReporting(false)} /> : null}
      <HiddenPostNotice status={answer.moderationStatus} authorId={answer.authorId} compact className="mt-2" />
      {mode === "edit" ? (
        <form className="mt-2 space-y-2" onSubmit={save}>
          <PostEditor ariaLabel={t("postEdit")} value={body} onChange={setBody} rows={3} />
          <PhotoEditor
            photos={answer.attachments ?? []}
            max={MAX_ANSWER_PHOTOS}
            upload={(file) => uploadAnswerPhoto(answer.id, file)}
            onChanged={() => qc.invalidateQueries({ queryKey: forumKeys.thread(threadId) })}
          />
          <PostActionErrorText error={error} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={update.isPending || !body.trim()}>
              {t("save")}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setMode("view")}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <RichText text={answer.body} className={compact ? "mt-1 text-sm text-primary/90" : "mt-2 text-sm text-primary/90"} />
          <PhotoGallery photos={answer.attachments ?? []} small />
          {mode === "view" && (onReply || actions) ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {actions}
              {onReply ? (
                <button
                  type="button"
                  onClick={onReply}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-label transition-colors hover:bg-background-2 hover:text-primary"
                >
                  <Reply className="h-3.5 w-3.5" aria-hidden />
                  {t("reply")}
                </button>
              ) : null}
            </div>
          ) : null}
          {mode === "confirmDelete" ? (
            <DeleteConfirm
              messageKey="deleteAnswerConfirm"
              busy={remove.isPending}
              onConfirm={() => void confirmDelete()}
              onCancel={() => setMode("view")}
            />
          ) : null}
          <PostActionErrorText error={error} />
        </>
      )}
    </div>
  );
}
