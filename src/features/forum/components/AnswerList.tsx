import type { Answer } from "@/entities/forum";
import { useAuth } from "@/app/AuthContext";
import { useLikeAnswer } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import { formatRelativeTime } from "@/shared/lib/format";
import { HiddenPostNotice } from "@/features/moderation/components/HiddenPostNotice";
import { slideFromPrevious } from "@/shared/lib/motion";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/Button";
import { postActionError, useDeleteAnswer, useUpdateAnswer, type PostActionError } from "../postActions";
import { DeleteConfirm, PostActionErrorText, PostMenu, usePostPermissions } from "./PostMenu";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { LikeButton } from "./LikeButton";

export function AnswerList({ threadId, answers }: { threadId: string; answers: Answer[] }) {
  const { user } = useAuth();
  const { locale, t } = useLocale();
  const likeAnswer = useLikeAnswer(threadId);

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
        const liked = user ? answer.likedByUserIds.includes(user.id) : false;
        return (
          <li
            key={answer.id}
            ref={(el) => {
              if (el) itemRefs.current.set(answer.id, el);
              else itemRefs.current.delete(answer.id);
            }}
            className="flex gap-3 rounded-xl border border-border/50 bg-white p-3"
          >
            <div className="flex flex-col items-center gap-1 pt-1">
              <LikeButton
                likes={answer.likes}
                active={liked}
                disabled={!user}
                busy={likeAnswer.isPending}
                label={liked ? t("unlikeAnswer") : t("likeAnswer")}
                onClick={() => {
                  if (!user) return;
                  likeAnswer.mutate({
                    answerId: answer.id,
                    userId: user.id,
                    scoreBefore: answer.likes,
                  });
                }}
              />
              {index === 0 ? (
                <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
                  {t("topAnswer")}
                </span>
              ) : null}
            </div>
            <AnswerContent threadId={threadId} answer={answer} locale={locale} />
          </li>
        );
      })}
    </ul>
  );
}

function AnswerContent({ threadId, answer, locale }: { threadId: string; answer: Answer; locale: string }) {
  const { t } = useLocale();
  const { canEdit, canDelete } = usePostPermissions(answer.authorId);
  const update = useUpdateAnswer(threadId);
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
        <UserAvatar userId={answer.authorId} name={answer.authorName} className="h-8 w-8 text-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary">{answer.authorName}</p>
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
          />
        ) : null}
      </div>
      <HiddenPostNotice status={answer.moderationStatus} authorId={answer.authorId} compact className="mt-2" />
      {mode === "edit" ? (
        <form className="mt-2 space-y-2" onSubmit={save}>
          <textarea
            aria-label={t("postEdit")}
            value={body}
            rows={3}
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
            className="w-full resize-y rounded-xl border border-border px-3 py-2 text-sm text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
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
          <p className="mt-2 whitespace-pre-wrap text-sm text-primary/90">{answer.body}</p>
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
