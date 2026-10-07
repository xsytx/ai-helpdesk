import { useFaqs } from "@/features/chat/api";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Card } from "@/shared/ui/Card";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

export function FaqPanel({ compact = true }: { compact?: boolean }) {
  const { t } = useLocale();
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: entries = [], isLoading, isError } = useFaqs();

  return (
    <Card className={compact ? "h-full" : ""}>
      <h3 className="text-lg font-bold text-primary">{t("faq")}</h3>
      <p className="mt-1 text-sm text-label">{t("faqSubtitle")}</p>
      {isLoading ? <p className="mt-4 text-sm text-label">{t("loading")}</p> : null}
      {isError ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {t("faqLoadFailed")}
        </p>
      ) : null}
      <ul className="mt-4 space-y-2">
        {entries.map((entry) => {
          const isOpen = openId === entry.id;
          return (
            <li key={entry.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? null : entry.id)}
                className={cn(
                  "flex w-full items-start justify-between gap-2 rounded-xl border border-border/80 bg-white px-3 py-3 text-left text-sm font-medium text-primary transition-colors hover:bg-background-2",
                  isOpen && "rounded-b-none border-b-0 bg-background-2",
                )}
              >
                <span>{entry.question}</span>
                <ChevronDown
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 text-label transition-transform",
                    isOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              {isOpen ? (
                <div className="rounded-b-xl border border-t-0 border-border/80 bg-background-2/50 px-3 py-3 text-sm leading-relaxed text-primary/90">
                  {entry.answer}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
