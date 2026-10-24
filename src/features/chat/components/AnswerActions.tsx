import { useRateAnswer, type ChatRating, type UiChatMessage } from "@/features/chat/api";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { copyText } from "@/shared/lib/clipboard";
import { plainText } from "@/shared/ui/RichText";
import { Check, Copy, MessageSquarePlus, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";

/** The answer as text: the knowledge-base/community answer and the AI explanation, or the reply. */
function answerText(msg: UiChatMessage): string {
  if (msg.forumAnswer && msg.basis !== "faq") {
    return [plainText(msg.forumAnswer), msg.aiExplanation].filter(Boolean).join("\n\n");
  }
  return msg.text;
}

/**
 * Under an AI answer: 👍/👎, and "ask on the forum" (with the student's
 * question). When the answer didn't help (the AI had none, or 👎) the
 * forum button says so and stands out.
 */
export function AnswerActions({
  msg,
  conversationId,
  onAskForum,
}: {
  msg: UiChatMessage;
  conversationId?: string;
  onAskForum: () => void;
}) {
  const { t } = useLocale();
  const rate = useRateAnswer(conversationId);
  const didNotHelp = msg.status === "fallback" || msg.rating === -1;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function toggle(value: ChatRating) {
    if (!msg.serverId) return;
    rate.mutate({ serverId: msg.serverId, value: msg.rating === value ? 0 : value, previous: msg.rating });
  }

  const rateButton = (value: ChatRating) => {
    const active = msg.rating === value;
    const Icon = value === 1 ? ThumbsUp : ThumbsDown;
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={value === 1 ? t("chatRateGood") : t("chatRateBad")}
        title={value === 1 ? t("chatRateGood") : t("chatRateBad")}
        onClick={() => toggle(value)}
        className={cn(
          "rounded-lg p-1.5 transition-colors hover:bg-background-2",
          active ? (value === 1 ? "text-green-700" : "text-error") : "text-label hover:text-primary",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", active && "fill-current")} />
      </button>
    );
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 pl-1">
      {msg.serverId ? (
        <>
          {rateButton(1)}
          {rateButton(-1)}
        </>
      ) : null}
      <button
        type="button"
        aria-label={copied ? t("chatCopied") : t("chatCopy")}
        title={copied ? t("chatCopied") : t("chatCopy")}
        onClick={() => void copyText(answerText(msg)).then(setCopied)}
        className={cn(
          "rounded-lg p-1.5 transition-colors hover:bg-background-2",
          copied ? "text-green-700" : "text-label hover:text-primary",
        )}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {didNotHelp ? <span className="ml-1 text-xs text-label">{t("chatDidNotHelp")}</span> : null}
      <button
        type="button"
        onClick={onAskForum}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors",
          didNotHelp
            ? "bg-brand text-white hover:bg-brand-hover"
            : "text-label hover:bg-background-2 hover:text-primary",
        )}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {t("searchAskForum")}
      </button>
    </div>
  );
}
