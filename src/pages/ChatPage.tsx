import { useAuth } from "@/app/AuthContext";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { useLocale } from "@/i18n/LocaleContext";
import { Card } from "@/shared/ui/Card";
import { ArrowUp } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export function ChatPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const location = useLocation();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const initialHandled = useRef(false);

  const sendUserMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: trimmed }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Thanks for your question about “${trimmed}”. When the ML service is connected, answers will combine top forum posts with an LLM explanation.`,
        },
      ]);
      setTyping(false);
    }, 900);
  }, []);

  useEffect(() => {
    if (initialHandled.current) return;
    const initial = (location.state as { initialQuery?: string } | null)?.initialQuery;
    if (initial) {
      initialHandled.current = true;
      sendUserMessage(initial);
      window.history.replaceState({}, document.title);
    }
  }, [location.state, sendUserMessage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-3xl flex-col gap-4 md:h-[calc(100dvh-6rem)]">
      <h1 className="text-xl font-bold text-primary">{t("newChat")}</h1>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-3 overflow-y-auto p-1">
          {messages.length === 0 ? (
            <p className="text-sm text-label">{t("askPlaceholder")}</p>
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
                  className="mr-auto max-w-[90%] rounded-2xl rounded-bl-md bg-background-2 px-4 py-2.5 text-sm text-primary"
                >
                  {msg.text}
                </div>
              ),
            )
          )}
          {typing ? (
            <p className="text-sm text-label" aria-live="polite">
              …
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
            className="w-full resize-none rounded-xl border border-border px-3 py-2 pr-12 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendUserMessage(input);
              }
            }}
          />
          <button
            type="button"
            onClick={() => sendUserMessage(input)}
            className="absolute bottom-5 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-light"
            aria-label={t("send")}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </Card>
    </div>
  );
}
