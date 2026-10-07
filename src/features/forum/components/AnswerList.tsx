import type { Answer } from "@/entities/forum";
import { useAuth } from "@/app/AuthContext";
import { useLikeAnswer } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import { formatRelativeTime } from "@/shared/lib/format";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { LikeButton } from "./LikeButton";

export function AnswerList({ threadId, answers }: { threadId: string; answers: Answer[] }) {
  const { user } = useAuth();
  const { locale, t } = useLocale();
  const likeAnswer = useLikeAnswer(threadId);

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
            className="flex gap-3 rounded-xl border border-border/50 bg-white p-3"
          >
            <div className="flex flex-col items-center gap-1 pt-1">
              <LikeButton
                likes={answer.likes}
                active={liked}
                disabled={!user || likeAnswer.isPending}
                label={liked ? t("unlikeAnswer") : t("likeAnswer")}
                onClick={() => {
                  if (!user) return;
                  likeAnswer.mutate({ answerId: answer.id, userId: user.id });
                }}
              />
              {index === 0 ? (
                <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
                  {t("topAnswer")}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <UserAvatar userId={answer.authorId} name={answer.authorName} className="h-8 w-8 text-[10px]" />
                <div>
                  <p className="text-sm font-semibold text-primary">{answer.authorName}</p>
                  <p className="text-xs text-label">
                    {formatRelativeTime(answer.createdAt, locale)}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm text-primary/90">{answer.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
