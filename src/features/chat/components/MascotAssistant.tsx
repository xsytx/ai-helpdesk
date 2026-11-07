// Barys in the corner of every page (not the chat itself): a click opens a
// small chat with the assistant. It uses the same streaming endpoint as the
// chat page, so the conversation is saved and "Open in full chat" continues it.
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { safeStorage } from "@/shared/lib/storage";
import { Mascot, type MascotMood } from "@/shared/ui/Mascot";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Maximize2, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  askChatStream,
  askResponseToUiMessage,
  chatErrorMessage,
  chatKeys,
  fetchChatStatus,
  upsertConversation,
  type ConversationList,
  type UiChatMessage,
} from "../api";
import { AssistantContent } from "./AssistantContent";
import { StreamingBubble } from "./StreamingBubble";

const HIDDEN_KEY = "ai_helpdesk_assistant_hidden";

/** Questions to start with, by the page you are on (the first matching path prefix). */
const PAGE_SUGGESTIONS: { path: string; keys: TranslationKey[] }[] = [
  { path: "/navigation", keys: ["assistantSuggestCanteen", "assistantSuggestLibrary", "assistantSuggestPrint"] },
  { path: "/forum", keys: ["assistantSuggestDorm", "assistantSuggestClubs", "assistantSuggestScholarship"] },
  { path: "/users", keys: ["assistantSuggestDorm", "assistantSuggestClubs", "assistantSuggestScholarship"] },
  { path: "/courses", keys: ["assistantSuggestGpa", "suggestionEcts", "suggestionSyllabus"] },
  { path: "/faq", keys: ["assistantSuggestAdvisor", "assistantSuggestRetake", "suggestionEcts"] },
  { path: "/", keys: ["suggestionDean", "suggestionEcts", "suggestionSyllabus"] },
];
const pageSuggestions = (pathname: string) =>
  (PAGE_SUGGESTIONS.find((s) => (s.path === "/" ? true : pathname.startsWith(s.path))) ?? PAGE_SUGGESTIONS[PAGE_SUGGESTIONS.length - 1]).keys;
const CHANGED = "sdu-assistant-visibility";

/**
 * Whether Barys sits in the corner: the × on him hides him, Settings turns him
 * on and off. Kept in this browser; every open page and tab follows a change.
 */
export function useAssistantVisible(): [boolean, (show: boolean) => void] {
  const [visible, setVisible] = useState(() => safeStorage.get(HIDDEN_KEY) !== "1");
  useEffect(() => {
    const sync = () => setVisible(safeStorage.get(HIDDEN_KEY) !== "1");
    const onStorage = (e: StorageEvent) => e.key === HIDDEN_KEY && sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const set = useCallback((show: boolean) => {
    if (show) safeStorage.remove(HIDDEN_KEY);
    else safeStorage.set(HIDDEN_KEY, "1");
    setVisible(show);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [visible, set];
}

/** md and up (Tailwind's 768px): laptops and tablets get the bigger Barys. */
function useWideScreen() {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function MascotAssistant() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useAssistantVisible();
  // The chat page is already a chat: no second one in the corner.
  if (!visible || pathname.startsWith("/chat")) return null;
  return <Widget pathname={pathname} onHide={() => setVisible(false)} />;
}

function Widget({ pathname, onHide }: { pathname: string; onHide: () => void }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const wide = useWideScreen();
  // Phones: he slides away while you scroll down (so he never hides the end of
  // a page) and comes back when you scroll up or stop at the bottom.
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 4;
      if (Math.abs(y - lastY) < 6) return;
      setTucked(y > lastY && y > 80 && !atBottom);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>();
  const [status, setStatus] = useState<"ok" | "degraded" | "unknown">("unknown");
  const abortRef = useRef<AbortController | null>(null);
  const streamedRef = useRef("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = streaming !== null;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    let cancelled = false;
    fetchChatStatus().then(
      (s) => !cancelled && setStatus(s),
      () => !cancelled && setStatus("degraded"),
    );
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Leaving the site mid-answer: stop it (the server keeps what was written).
  useEffect(() => () => abortRef.current?.abort(), []);

  const scrollDown = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(scrollDown, [messages, scrollDown]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: q }]);
    setStreaming("");
    streamedRef.current = "";
    const controller = new AbortController();
    abortRef.current = controller;
    let convId = conversationId;
    try {
      const res = await askChatStream(
        q,
        conversationId,
        {
          onConversation: (conv) => {
            convId = conv.id;
            setConversationId(conv.id);
            queryClient.setQueryData<ConversationList>(chatKeys.conversations, (old) => upsertConversation(old, conv));
          },
          onDelta: (text) => {
            streamedRef.current += text;
            setStreaming(streamedRef.current);
          },
          onReset: () => {
            streamedRef.current = "";
            setStreaming("");
          },
        },
        controller.signal,
      );
      setStatus("ok");
      setMessages((m) => [...m, askResponseToUiMessage(res)]);
    } catch (err) {
      if (controller.signal.aborted) {
        // Stopped: keep what was written.
        const text = streamedRef.current;
        if (text) setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text, status: "answered" }]);
      } else {
        if ((err as { status?: number })?.status === 503) setStatus("degraded");
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: "assistant", text: chatErrorMessage(err, t), error: true },
        ]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(null);
      if (convId) void queryClient.invalidateQueries({ queryKey: chatKeys.messages(convId) });
    }
  }

  // The only Barys on screen (the corner button): thinking while he answers,
  // asleep when the assistant is off, waving when you point at him.
  // asleep when the assistant is off, puzzled when he had no answer, waving
  // when you point at him; on the map page he points at the map.
  const last = messages[messages.length - 1];
  const noAnswer = last?.role === "assistant" && (last.error || last.status === "fallback");
  const mood: MascotMood = busy
    ? "think"
    : status === "degraded"
      ? "sleep"
      : hover
        ? "hello"
        : noAnswer
          ? "confused"
          : pathname.startsWith("/navigation") && !open
            ? "point-left"
            : "idle";
  const suggestions = messages.length === 0 ? pageSuggestions(pathname).map((k) => t(k)) : last?.followups ?? [];

  return (
    <div
      className={cn(
        "sdu-assistant fixed bottom-[5.5rem] right-3 z-40 flex flex-col items-end gap-2 transition-[transform,opacity] duration-300 md:bottom-5 md:right-5",
        tucked && !open && "max-md:pointer-events-none max-md:translate-x-[120%] max-md:opacity-0",
      )}
    >
      {open ? (
        <section
          role="dialog"
          aria-label={t("assistantName")}
          className="flex h-[min(32rem,calc(100dvh-9rem))] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border/60 bg-surface shadow-2xl motion-safe:animate-[assistant-in_200ms_cubic-bezier(0.2,0.8,0.2,1)]"
        >
          {/* No Barys here: the one in the corner below shows how he is (thinking, asleep). */}
          <header className="flex items-center gap-2 border-b border-border/50 py-2 pl-4 pr-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-primary">{t("assistantName")}</p>
              <p className="truncate text-xs text-label">
                {status === "degraded" ? t("assistantSleeping") : busy ? t("assistantThinking") : t("assistantRole")}
              </p>
            </div>
            {conversationId ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(`/chat/${conversationId}`, { viewTransition: true });
                }}
                className="rounded-lg p-1.5 text-label hover:bg-background-2 hover:text-primary"
                title={t("assistantOpenFull")}
                aria-label={t("assistantOpenFull")}
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-label hover:bg-background-2 hover:text-primary"
              aria-label={t("close")}
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 ? (
              <div className="mr-auto max-w-[90%] rounded-2xl rounded-bl-md bg-background-2 px-4 py-2.5 text-sm text-primary">
                {status === "degraded" ? t("chatAssistantUnavailable") : t("assistantHello")}
              </div>
            ) : null}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm text-white">
                  {m.text}
                </div>
              ) : m.error ? (
                <p key={m.id} className="mr-auto max-w-[90%] rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-800">
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className="mr-auto max-w-[95%]">
                  <AssistantContent msg={m} />
                </div>
              ),
            )}
            {streaming !== null ? (
              streaming ? (
                <StreamingBubble text={streaming} onGrow={scrollDown} />
              ) : (
                <div className="mr-auto flex w-fit gap-1 rounded-2xl rounded-bl-md bg-background-2 px-4 py-3.5" aria-label={t("assistantThinking")}>
                  {[0, 150, 300].map((delay) => (
                    <span key={delay} className="h-1.5 w-1.5 rounded-full bg-label/60 motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </div>
              )
            ) : null}
            {!busy && suggestions.length > 0 && status !== "degraded" ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="rounded-full border border-border bg-surface px-3 py-1 text-left text-xs font-medium text-primary hover:bg-background-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <form
            className="flex items-end gap-2 border-t border-border/50 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder={t("askPlaceholder")}
              className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-border bg-background-2/50 px-3 py-2 text-sm text-primary outline-none placeholder:text-label/70 focus:border-brand"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background-2 text-primary hover:bg-background-2-hover"
                aria-label={t("assistantStop")}
                title={t("assistantStop")}
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
                aria-label={t("send")}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </form>
        </section>
      ) : null}

      <div
        className="group relative"
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        {!open ? (
          <span className="pointer-events-none absolute bottom-full right-0 mb-1 hidden whitespace-nowrap rounded-xl bg-surface px-3 py-1.5 text-xs font-semibold text-primary shadow-md md:group-hover:block">
            {t("assistantAsk")}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={t("assistantAsk")}
          className={cn(
            "flex items-center justify-center rounded-full border border-border/60 bg-surface shadow-lg transition-transform motion-safe:hover:scale-105",
            // Laptops: a big round button. Phones: a small one, except when he
            // points (the paw needs room): then a wider pill.
            wide ? "h-[5.5rem] w-[5.5rem]" : mood === "point-left" ? "h-16 px-2.5" : "h-16 w-16",
            open && "ring-2 ring-brand/40",
          )}
        >
          <Mascot mood={mood} size={wide || mood === "point-left" ? "md" : "sm"} />
        </button>
        {!open ? (
          <button
            type="button"
            onClick={onHide}
            className="absolute -left-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-label shadow group-hover:flex group-focus-within:flex hover:text-primary"
            aria-label={t("assistantHide")}
            title={t("assistantHideHint")}
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
