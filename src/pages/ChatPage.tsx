import { useAuth } from "@/app/AuthContext";
import { faqText, type FaqEntry } from "@/entities/faq";
import {
  askChat,
  askFaq,
  askResponseToUiMessage,
  chatErrorMessage,
  chatKeys,
  fetchChatStatus,
  toConversation,
  upsertConversation,
  useChatMessages,
  type ConversationList as ConversationListData,
  type ConversationMessages,
  type UiChatMessage,
} from "@/features/chat/api";
import { ConversationList } from "@/features/chat/components/ConversationList";
import { FaqQuickReplies } from "@/features/chat/components/FaqQuickReplies";
import { useFaqs } from "@/features/faq/api";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { getErrorStatus } from "@/shared/api/client";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, History, Loader2, Plus, X, Zap } from "lucide-react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
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

/** Where a question goes: a saved chat, or "new" (the server creates the chat). */
interface Target {
  key: string;
  conversationId?: string;
}

const NEW_CHAT = "new";

/** The phone version of the chat list: a panel sliding over the page. */
function ChatListSheet({ activeId, onClose }: { activeId?: string; onClose: () => void }) {
  const { t } = useLocale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // On <body>: the page area is its own layer (page transitions) and would trap it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex bg-primary/30 lg:hidden">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-list-title"
        className="flex w-[85%] max-w-xs flex-col bg-white p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="chat-list-title" className="text-lg font-bold text-primary">
            {t("chats")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-label hover:bg-background-2"
            aria-label={t("close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <Button asChild variant="secondary" size="sm" className="mb-3 justify-start">
          <Link to="/chat" onClick={onClose}>
            <Plus className="h-4 w-4" />
            {t("newChat")}
          </Link>
        </Button>
        <ConversationList activeId={activeId} onNavigate={onClose} />
      </div>
      <div className="flex-1" aria-hidden onClick={onClose} />
    </div>,
    document.body,
  );
}

export function ChatPage() {
  const { t, locale } = useLocale();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { conversationId } = useParams();
  const key = conversationId ?? NEW_CHAT;
  const keyRef = useRef(key);
  keyRef.current = key;

  const saved = useChatMessages(conversationId);
  const [input, setInput] = useState("");
  // Messages not saved on the server yet (the question being answered, errors), per chat.
  const [drafts, setDrafts] = useState<Record<string, UiChatMessageWithRetry[]>>({});
  // The chat whose question is being answered: one at a time (the server allows one).
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const hasFaqButtons = (useFaqs().data ?? []).some((f) => f.pinned);
  const closeList = useCallback(() => setListOpen(false), []);
  const [assistantStatus, setAssistantStatus] = useState<"ok" | "degraded" | "unknown">("unknown");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialHandled = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const translate = useCallback(
    (key: string) => t(key as Parameters<typeof t>[0]),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    fetchChatStatus().then(
      (status) => !cancelled && setAssistantStatus(status),
      () => !cancelled && setAssistantStatus("degraded"),
    );
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  // The first answer after a pause can take up to a minute on a local model: tell the student we are still working.
  useEffect(() => {
    if (!pendingKey) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 15_000);
    return () => window.clearTimeout(timer);
  }, [pendingKey]);

  const setDraft = useCallback((k: string, update: (list: UiChatMessageWithRetry[]) => UiChatMessageWithRetry[]) => {
    setDrafts((d) => ({ ...d, [k]: update(d[k] ?? []) }));
  }, []);

  // retryBubbleId: re-sending a question whose bubble is already on screen.
  // faqId: an FAQ button, answered from the FAQ at once instead of by the model.
  const sendUserMessage = useCallback(
    async (text: string, target: Target, retryBubbleId?: string, faqId?: string) => {
      const trimmed = text.trim();
      if (!trimmed || pendingRef.current) return;

      const ac = new AbortController();
      abortRef.current = ac;
      const bubbleId = retryBubbleId ?? crypto.randomUUID();
      if (!retryBubbleId) setDraft(target.key, (list) => [...list, { id: bubbleId, role: "user", text: trimmed }]);
      if (target.key === keyRef.current) setInput("");
      pendingRef.current = target.key;
      setPendingKey(target.key);

      try {
        const res = faqId
          ? await askFaq(faqId, locale, target.conversationId, ac.signal)
          : await askChat(trimmed, target.conversationId, ac.signal);
        setAssistantStatus("ok");
        const conv = toConversation(res.conversation);
        const answered: UiChatMessage[] = [
          { id: bubbleId, role: "user", text: trimmed },
          askResponseToUiMessage(res),
        ];
        const messagesKey = chatKeys.messages(conv.id);
        if (target.key === NEW_CHAT || queryClient.getQueryData(messagesKey)) {
          queryClient.setQueryData<ConversationMessages>(messagesKey, (old) => ({
            conversation: conv,
            messages: [...(old?.messages ?? []), ...answered],
          }));
        } else {
          void queryClient.invalidateQueries({ queryKey: messagesKey });
        }
        queryClient.setQueryData<ConversationListData>(chatKeys.conversations, (old) => upsertConversation(old, conv));
        if (!queryClient.getQueryData(chatKeys.conversations)) {
          void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
        }
        setDraft(target.key, (list) => list.filter((m) => m.id !== bubbleId));
        // A new chat now has an address; go there unless the student opened another chat meanwhile.
        if (target.key === NEW_CHAT && keyRef.current === NEW_CHAT) {
          navigate(`/chat/${conv.id}`, { replace: true });
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        const errMsg = getErrorStatus(err) === 404 ? t("chatNotFound") : chatErrorMessage(err, translate);
        const errId = crypto.randomUUID();
        setDraft(target.key, (list) => [
          ...list,
          {
            id: errId,
            role: "assistant",
            text: errMsg,
            error: true,
            retryQuestion: trimmed,
            onRetry: () => {
              setDraft(target.key, (l) => l.filter((x) => x.id !== errId));
              void sendUserMessage(trimmed, target, bubbleId, faqId);
            },
          },
        ]);
        if (getErrorStatus(err) === 503) setAssistantStatus("degraded");
      } finally {
        if (!ac.signal.aborted) {
          pendingRef.current = null;
          setPendingKey(null);
        }
      }
    },
    [locale, navigate, queryClient, setDraft, t, translate],
  );

  // A question asked on the home page arrives here and starts a new chat.
  useEffect(() => {
    if (initialHandled.current) return;
    const initial = (location.state as { initialQuery?: string } | null)?.initialQuery;
    if (initial && !conversationId) {
      initialHandled.current = true;
      void sendUserMessage(initial, { key: NEW_CHAT });
      // Clear the question so a reload or "back" doesn't send it again. Through
      // the router: window.history.replaceState({}) would also wipe the
      // router's own entry data and confuse back/forward navigation.
      navigate(".", { replace: true, state: null });
    }
  }, [location.state, sendUserMessage, conversationId, navigate]);

  // Text handed over without sending (e.g. a forum search that found
  // nothing): put it in the input so the student can add to it, then send.
  useEffect(() => {
    const draft = (location.state as { draftQuery?: string } | null)?.draftQuery;
    if (!draft) return;
    setInput(draft);
    navigate(".", { replace: true, state: null });
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [location.state, navigate]);

  const notFound = Boolean(conversationId) && saved.isError && getErrorStatus(saved.error) === 404;
  const historyLoading = Boolean(conversationId) && saved.isPending;
  const messages: UiChatMessageWithRetry[] = [
    ...(conversationId ? (saved.data?.messages ?? []) : []),
    ...(drafts[key] ?? []),
  ];
  const loading = pendingKey === key;
  const busyElsewhere = pendingKey !== null && !loading;
  const title = conversationId ? saved.data?.conversation.title || (saved.data ? t("chatUntitled") : "") : t("newChat");

  // Jump to the end when a chat opens; scroll smoothly as new messages arrive.
  const lastKey = useRef(key);
  useEffect(() => {
    const switched = lastKey.current !== key;
    lastKey.current = key;
    endRef.current?.scrollIntoView({ behavior: switched ? "auto" : "smooth" });
  }, [key, messages.length, loading]);

  const send = () => void sendUserMessage(input, { key, conversationId });
  const sendFaq = (entry: FaqEntry) => {
    setFaqOpen(false);
    void sendUserMessage(faqText(entry, locale).question, { key, conversationId }, undefined, entry.id);
  };
  const inputDisabled = pendingKey !== null || notFound || historyLoading;

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-5xl gap-4 md:h-[calc(100dvh-6rem)]">
      <Card className="hidden w-60 shrink-0 flex-col p-3 md:p-3 lg:flex">
        <h2 className="mb-2 px-2 text-sm font-bold text-primary">{t("chats")}</h2>
        <ConversationList activeId={conversationId} />
      </Card>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="shrink-0 rounded-xl border border-border/60 bg-white p-2 text-primary hover:bg-background-2 lg:hidden"
            aria-label={t("chats")}
          >
            <History className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 truncate text-xl font-bold text-primary" title={title}>
            {title || " "}
          </h1>
        </div>
        {assistantStatus === "degraded" ? (
          <p className="rounded-xl border border-border bg-background-2 px-3 py-2 text-sm text-label" role="status">
            {t("chatDegradedBanner")}
          </p>
        ) : null}
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto p-1">
            {notFound ? (
              <div className="space-y-3">
                <p className="text-sm text-label">{t("chatNotFound")}</p>
                <Button asChild size="sm">
                  <Link to="/chat" replace>
                    <Plus className="h-4 w-4" />
                    {t("newChat")}
                  </Link>
                </Button>
              </div>
            ) : historyLoading ? (
              <p className="text-sm text-label">{t("loading")}</p>
            ) : conversationId && saved.isError ? (
              <p className="text-sm text-error">{t("serverUnavailable")}</p>
            ) : messages.length === 0 ? (
              <div>
                <p className="text-sm text-label">{t("askPlaceholder")}</p>
                <FaqQuickReplies onSelect={sendFaq} disabled={pendingKey !== null} />
              </div>
            ) : (
              messages.map((msg) =>
                msg.role === "user" ? (
                  <div key={msg.id} className="flex items-end justify-end gap-2">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-white">
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
            {/* In a chat that already has messages, the FAQ buttons fold out above the input. */}
            {hasFaqButtons && messages.length > 0 && !notFound ? (
              <div className="mb-2">
                <button
                  type="button"
                  aria-expanded={faqOpen}
                  onClick={() => setFaqOpen((o) => !o)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-label hover:bg-background-2 hover:text-primary"
                >
                  <Zap className="h-3.5 w-3.5 text-accent" aria-hidden />
                  {t("chatQuickQuestions")}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", faqOpen && "rotate-180")} aria-hidden />
                </button>
                {faqOpen ? (
                  <div className="max-h-48 overflow-y-auto">
                    <FaqQuickReplies hideTitle onSelect={sendFaq} disabled={pendingKey !== null} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {busyElsewhere ? (
              <p className="mb-2 flex items-center gap-2 text-xs text-label" aria-live="polite">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t("chatWaitingOther")}
              </p>
            ) : null}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("askPlaceholder")}
              rows={2}
              disabled={inputDisabled}
              className="w-full resize-none rounded-xl border border-border px-3 py-2 pr-12 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="button"
              disabled={inputDisabled || !input.trim()}
              onClick={send}
              className="absolute bottom-5 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t("send")}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </Card>
      </div>

      {listOpen ? <ChatListSheet activeId={conversationId} onClose={closeList} /> : null}
    </div>
  );
}
