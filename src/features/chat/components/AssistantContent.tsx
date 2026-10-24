import type { UiChatMessage } from "@/features/chat/api";
import { useLocale } from "@/i18n/LocaleContext";
import { RichText } from "@/shared/ui/RichText";
import { CheckCircle2, ShieldCheck, ThumbsUp, Users, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

function showsKnowledgeBase(msg: UiChatMessage): boolean {
  if (msg.status === "fallback") return false;
  const basis = msg.basis ?? "";
  return (basis === "retrieved" || basis === "context") && Boolean(msg.forumAnswer);
}

function Badge({ icon, children, tone }: { icon: ReactNode; children: ReactNode; tone: "green" | "violet" | "plain" }) {
  const tones = {
    green: "bg-green-50 text-green-700",
    violet: "bg-violet-50 text-violet-700",
    plain: "bg-surface text-label",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

/** How far a community answer can be trusted: accepted, by staff, likes. */
function TrustBadges({ msg }: { msg: UiChatMessage }) {
  const { t, plural } = useLocale();
  const likes = msg.sourceLikes ?? 0;
  if (!msg.sourceAccepted && !msg.sourceStaff && likes <= 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {msg.sourceAccepted ? (
        <Badge tone="green" icon={<CheckCircle2 className="h-3 w-3" aria-hidden />}>
          {t("chatTrustAccepted")}
        </Badge>
      ) : null}
      {msg.sourceStaff ? (
        <Badge tone="violet" icon={<ShieldCheck className="h-3 w-3" aria-hidden />}>
          {t("chatTrustStaff")}
        </Badge>
      ) : null}
      {likes > 0 ? (
        <Badge tone="plain" icon={<ThumbsUp className="h-3 w-3" aria-hidden />}>
          {plural(likes, "chatTrustLikes")}
        </Badge>
      ) : null}
    </div>
  );
}

/** The inside of an assistant's bubble, by what kind of answer it is. */
export function AssistantContent({ msg }: { msg: UiChatMessage & { onRetry?: () => void } }) {
  const { t } = useLocale();

  if (msg.error) {
    return (
      <div className="space-y-2">
        <p className="text-error">{msg.text}</p>
        {msg.retryQuestion ? (
          <button
            type="button"
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => msg.onRetry?.()}
          >
            {t("chatRetry")}
          </button>
        ) : null}
      </div>
    );
  }

  if (msg.basis === "stopped") {
    return (
      <div className="space-y-1">
        <p className="whitespace-pre-wrap">{msg.text}</p>
        <p className="text-xs italic text-label">{t("chatStoppedNote")}</p>
      </div>
    );
  }

  if (msg.basis === "faq") {
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-label">
          <Zap className="h-3 w-3 text-accent" aria-hidden />
          {t("chatFaqInstant")}
        </p>
        <p className="whitespace-pre-wrap">{msg.text}</p>
      </div>
    );
  }

  if (showsKnowledgeBase(msg)) {
    const fromForum = msg.sourceType === "forum";
    return (
      <div className="space-y-3">
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-label">
            {fromForum ? <Users className="h-3 w-3 text-accent" aria-hidden /> : null}
            {t(fromForum ? "chatCommunityAnswer" : "chatKbAnswer")}
          </p>
          {fromForum ? <RichText text={msg.forumAnswer!} /> : <p className="whitespace-pre-wrap">{msg.forumAnswer}</p>}
          {fromForum ? <TrustBadges msg={msg} /> : null}
          {fromForum && msg.sourceThreadId ? (
            <Link
              viewTransition
              to={`/forum/${msg.sourceThreadId}`}
              className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium text-primary-light hover:underline"
            >
              {t("chatOpenDiscussion")} →
            </Link>
          ) : null}
        </div>
        {msg.aiExplanation ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-label">{t("chatAiExplanation")}</p>
            <p className="whitespace-pre-wrap">{msg.aiExplanation}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return <p className="whitespace-pre-wrap">{msg.text}</p>;
}
