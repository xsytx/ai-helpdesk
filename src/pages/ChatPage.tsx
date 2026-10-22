import { useAuth } from "@/app/AuthContext";
import {
  askChat,
  askResponseToUiMessage,
  chatErrorMessage,
  fetchChatHistory,
  fetchChatStatus,
  historyToUiMessages,
  type UiChatMessage,
} from "@/features/chat/api";
import { FaqQuickReplies } from "@/features/chat/components/FaqQuickReplies";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { getErrorStatus } from "@/shared/api/client";
import { Card } from "@/shared/ui/Card";
import { ArrowUp, Loader2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";

function showsKnowledgeBase(msg: UiChatMessage): boolean {
  if (msg.status === "fallback") return false;
  const basis = msg.basis ?? "";
  return (basis === "retrieved" || basis === "context") && Boolean(msg.forumAnswer);
}

function AssistantContent({
  msg,
  t,
}: {
  msg: UiChatMessage & { onRetry?: () => void };
  t: (k: string) => string;
}) {
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

  if (showsKnowledgeBase(msg)) {
    return (
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-label">{t("chatKbAnswer")}</p>
          <p className="whitespace-pre-wrap">{msg.forumAnswer}</p>
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

type UiChatMessageWithRetry = UiChatMessage & { onRetry?: () => void };

export function ChatPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiChatMessageWithRetry[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<"ok" | "degraded" | "unknown">("unknown");
  const endRef = useRef<HTMLDivElement>(null);
  const initialHandled = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const translate = useCallback(
    (key: string) => t(key as Parameters<typeof t>[0]),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rows, status] = await Promise.all([fetchChatHistory(), fetchChatStatus()]);
        if (!cancelled) {
          setMessages(historyToUiMessages(rows));
          setAssistantStatus(status);
        }
      } catch {
        if (!cancelled) setAssistantStatus("degraded");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // The first answer after a pause can take up to a minute on a local model: tell the student we are still working.
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 15_000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const sendUserMessage = useCallback(
    async (text: string, isRetry = false) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      // A retry re-sends a question that is already on screen: do not draw the bubble twice.
      if (!isRetry) {
        setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: trimmed }]);
      }
      setInput("");
      setLoading(true);

      try {
        const res = await askChat(trimmed, ac.signal);
        setAssistantStatus("ok");
        setMessages((m) => [...m, askResponseToUiMessage(res)]);
      } catch (err) {
        if (ac.signal.aborted) return;
        const errMsg = chatErrorMessage(err, translate);
        const errId = crypto.randomUUID();
        setMessages((m) => [
          ...m,
          {
            id: errId,
            role: "assistant",
            text: errMsg,
            error: true,
            retryQuestion: trimmed,
            onRetry: () => {
              setMessages((prev) => prev.filter((x) => x.id !== errId));
              void sendUserMessage(trimmed, true);
            },
          },
        ]);
        if (getErrorStatus(err) === 503) setAssistantStatus("degraded");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [loading, translate],
  );

  useEffect(() => {
    if (initialHandled.current || historyLoading) return;
    const initial = (location.state as { initialQuery?: string } | null)?.initialQuery;
    if (initial) {
      initialHandled.current = true;
      void sendUserMessage(initial);
      // Clear the question so a reload or "back" doesn't send it again. Through
      // the router: window.history.replaceState({}) would also wipe the
      // router's own entry data and confuse back/forward navigation.
      navigate(".", { replace: true, state: null });
    }
  }, [location.state, sendUserMessage, historyLoading, navigate]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const inputDisabled = loading;

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-3xl flex-col gap-4 md:h-[calc(100dvh-6rem)]">
      <h1 className="text-xl font-bold text-primary">{t("newChat")}</h1>
      {assistantStatus === "degraded" ? (
        <p className="rounded-xl border border-border bg-background-2 px-3 py-2 text-sm text-label" role="status">
          {t("chatDegradedBanner")}
        </p>
      ) : null}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-3 overflow-y-auto p-1">
          {historyLoading ? (
            <p className="text-sm text-label">{t("loading")}</p>
          ) : messages.length === 0 ? (
            <div>
              <p className="text-sm text-label">{t("askPlaceholder")}</p>
              <FaqQuickReplies onSelect={(q) => void sendUserMessage(q)} disabled={loading} />
            </div>
          ) : (
            messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex items-end justify-end gap-2">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-white">
                    {msg.text}
                  </div>
                  <UserAvatar name={user?.name ?? ""} className="h-7 w-7 text-[10px]" />
                </div>
              ) : (
                <div
                  key={msg.id}
                  className={cn(
                    "mr-auto max-w-[90%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-primary",
                    msg.error ? "border border-error/30 bg-white" : "bg-background-2",
                  )}
                >
                  <AssistantContent msg={msg} t={translate} />
                </div>
              ),
            )
          )}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-label" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {slow ? t("chatSlowHint") : t("chatTyping")}
            </p>
          ) : null}
          <div ref={endRef} />
        </div>
        <div className="relative mt-3 border-t border-border/50 pt-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("askPlaceholder")}
            rows={2}
            disabled={inputDisabled}
            className="w-full resize-none rounded-xl border border-border px-3 py-2 pr-12 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendUserMessage(input);
              }
            }}
          />
          <button
            type="button"
            disabled={inputDisabled || !input.trim()}
            onClick={() => void sendUserMessage(input)}
            className="absolute bottom-5 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t("send")}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </Card>
    </div>
  );
}
