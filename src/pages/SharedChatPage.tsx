import { useSharedChat } from "@/features/chat/api";
import { AssistantContent } from "@/features/chat/components/AssistantContent";
import { useLocale } from "@/i18n/LocaleContext";
import { formatRelativeTime } from "@/shared/lib/format";
import { LanguageSwitcher } from "@/shared/layout/LanguageSwitcher";
import { Logo } from "@/shared/layout/Logo";
import { ThemeToggle } from "@/shared/layout/ThemeToggle";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { MessageCircle } from "lucide-react";
import { Link, useParams } from "react-router-dom";

/** A chat someone shared by link: read-only, no names, no login needed. */
export function SharedChatPage() {
  const { token = "" } = useParams();
  const { t, locale } = useLocale();
  const { data, isLoading, isError } = useSharedChat(token);

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="flex items-center justify-between px-5 py-4 md:px-8">
        <Logo />
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10">
        <Card>
          {isLoading ? (
            <p className="text-sm text-label">{t("loading")}</p>
          ) : isError || !data ? (
            <p className="text-sm text-label">{t("sharedChatNotFound")}</p>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-label">{t("sharedChatTitle")}</p>
              <h1 className="mt-1 text-xl font-bold text-primary">{data.title || t("chatUntitled")}</h1>
              <p className="mt-0.5 text-xs text-label">{formatRelativeTime(data.createdAt, locale)}</p>
              <div className="mt-5 space-y-3">
                {data.messages.map((msg) =>
                  msg.role === "user" ? (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm text-white">
                        {msg.text}
                      </div>
                    </div>
                  ) : (
                    <div key={msg.id} className="mr-auto max-w-[90%] rounded-2xl rounded-bl-md bg-background-2 px-4 py-2.5 text-sm text-primary">
                      <AssistantContent msg={msg} />
                    </div>
                  ),
                )}
              </div>
            </>
          )}
          <div className="mt-6 border-t border-border/50 pt-4">
            <Button asChild>
              <Link to="/chat">
                <MessageCircle className="h-4 w-4" />
                {t("sharedChatAskYourOwn")}
              </Link>
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
