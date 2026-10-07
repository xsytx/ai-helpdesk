import { AnswerList } from "@/features/forum/components/AnswerList";
import { ReplyForm } from "@/features/forum/components/ReplyForm";
import { useAnswers, useThread } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import { formatRelativeTime } from "@/shared/lib/format";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { Card } from "@/shared/ui/Card";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";

export function ThreadDetailPage() {
  const { threadId = "" } = useParams();
  const { locale, t } = useLocale();
  const { data: thread, isLoading, isError } = useThread(threadId);
  const { data: answers = [], isLoading: answersLoading } = useAnswers(threadId);

  if (isLoading) {
    return <p className="text-sm text-label">{t("loading")}</p>;
  }

  if (isError || !thread) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <p className="text-sm text-red-600">{t("threadNotFound")}</p>
          <Link to="/forum" className="mt-3 inline-block text-sm font-medium text-primary-light">
            ← {t("backToForum")}
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        to="/forum"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary-light hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToForum")}
      </Link>

      <Card>
        <div className="flex gap-3">
          <UserAvatar userId={thread.authorId} name={thread.authorName} />
          <div>
            <p className="text-xs text-label">
              {thread.authorName} · {formatRelativeTime(thread.createdAt, locale)}
            </p>
            <h1 className="mt-1 text-xl font-bold text-primary">{thread.title}</h1>
            <p className="mt-2 text-sm text-primary/90">{thread.body}</p>
          </div>
        </div>
      </Card>

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
            <AnswerList threadId={threadId} answers={answers} />
          </div>
        )}
      </Card>

      <Card>
        <ReplyForm threadId={threadId} />
      </Card>
    </div>
  );
}
