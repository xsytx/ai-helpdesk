import { plainText } from "@/shared/ui/RichText";
import { useAuth } from "@/app/AuthContext";
import { useUserQuestions } from "@/features/forum/api";
import { ThreadList } from "@/features/forum/components/ThreadList";
import { useUserAnswers, useUserProfile } from "@/features/profile/api";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { LevelBadge } from "@/features/reputation/components/LevelBadge";
import { useLocale } from "@/i18n/LocaleContext";
import { getErrorStatus } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { CheckCircle2, ChevronUp, MessageCircle, Settings, ShieldCheck, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

const INTL_LOCALE = { en: "en", kz: "kk", ru: "ru" } as const;

/** /users/:userId — a student's public page: level, points, questions and answers. */
export function ProfilePage() {
  const { userId = "" } = useParams();
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const profile = useUserProfile(userId);
  const [tab, setTab] = useState<"answers" | "questions">("answers");

  if (profile.isPending) return <p className="text-sm text-label">{t("loading")}</p>;
  if (profile.isError) {
    return (
      <Card className="mx-auto max-w-lg">
        <p className="text-sm text-error">{getErrorStatus(profile.error) === 404 ? t("profileNotFound") : t("serverUnavailable")}</p>
      </Card>
    );
  }

  const p = profile.data;
  const isMe = user?.id === p.id;
  const joined = new Date(p.joinedAt).toLocaleDateString(INTL_LOCALE[locale], { month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <UserAvatar userId={p.id} name={p.name} avatar={p.avatar} className="h-20 w-20 text-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-primary">
              {p.name}
              <LevelBadge level={p.reputation.level} points={p.reputation.points} className="px-2 py-1 text-xs" />
              {p.staff ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-1 text-xs font-semibold text-white">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  {t("profileStaff")}
                </span>
              ) : null}
            </h1>
            {p.major ? <p className="mt-0.5 text-sm text-label">{p.major}</p> : null}
            <p className="mt-0.5 text-xs text-label">{t("profileJoined").replace("{date}", joined)}</p>
          </div>
          {isMe ? (
            <Button asChild size="sm" variant="secondary">
              <Link viewTransition to="/settings">
                <Settings className="h-4 w-4" />
                {t("profileEdit")}
              </Link>
            </Button>
          ) : null}
        </div>
        {p.bio ? <p className="mt-4 whitespace-pre-wrap text-sm text-primary/90">{p.bio}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          {[
            { icon: ChevronUp, value: p.reputation.points, label: t("profilePoints") },
            { icon: CheckCircle2, value: p.reputation.solutions, label: t("repSolutions") },
            { icon: ThumbsUp, value: p.reputation.likes, label: t("repLikes") },
            { icon: MessageCircle, value: p.questions, label: t("profileQuestions") },
          ].map(({ icon: Icon, value, label }) => (
            <div key={label} className="rounded-xl bg-background-2/60 px-2 py-3">
              <Icon className="mx-auto h-4 w-4 text-primary-light" aria-hidden />
              <p className="mt-1 text-lg font-bold text-primary">{value}</p>
              <p className="text-[11px] text-label">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex gap-1 border-b border-border/60" role="tablist">
          {(
            [
              ["answers", t("profileAnswersTab"), p.reputation.answers],
              ["questions", t("profileQuestionsTab"), p.questions],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
                tab === id ? "border-primary text-primary" : "border-transparent text-label hover:text-primary",
              )}
            >
              {label} ({count})
            </button>
          ))}
        </div>
        {tab === "answers" ? <AnswersTab userId={p.id} /> : <QuestionsTab userId={p.id} />}
      </Card>
    </div>
  );
}

function QuestionsTab({ userId }: { userId: string }) {
  const { t } = useLocale();
  const { data: threads = [], isPending } = useUserQuestions(userId);
  if (isPending) return <p className="text-sm text-label">{t("loading")}</p>;
  if (threads.length === 0) return <p className="py-4 text-center text-sm text-label">{t("profileNoQuestions")}</p>;
  return <ThreadList threads={threads} />;
}

function AnswersTab({ userId }: { userId: string }) {
  const { t, locale } = useLocale();
  const { data: answers = [], isPending } = useUserAnswers(userId);
  if (isPending) return <p className="text-sm text-label">{t("loading")}</p>;
  if (answers.length === 0) return <p className="py-4 text-center text-sm text-label">{t("profileNoAnswers")}</p>;
  return (
    <ul className="divide-y divide-border/40">
      {answers.map((a) => (
        <li key={a.id}>
          <Link viewTransition to={`/forum/${a.threadId}`} className="block rounded-xl p-2 transition-colors hover:bg-background-2/80">
            <p className="flex flex-wrap items-center gap-2 text-xs text-label">
              <span className="font-medium text-primary/80">{a.threadTitle}</span>
              <span>· {formatRelativeTime(a.createdAt, locale)}</span>
              {a.isSolution ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  {t("solution")}
                </span>
              ) : null}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-primary/90">{plainText(a.body)}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-label">
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
              {a.likes}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
