import { FAQ_CATEGORIES, faqText, type FaqEntry } from "@/entities/faq";
import { useFaqs } from "@/features/faq/api";
import { FAQ_CATEGORY_KEY } from "@/features/faq/categories";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Card } from "@/shared/ui/Card";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

/**
 * The FAQ in the site language. compact (home page): one list; full (FAQ
 * page): grouped by category when there is more than one.
 */
export function FaqPanel({ compact = true }: { compact?: boolean }) {
  const { t } = useLocale();
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: entries = [], isLoading, isError } = useFaqs();
  const categories = FAQ_CATEGORIES.filter((c) => entries.some((e) => e.category === c));
  const grouped = !compact && categories.length > 1;

  const list = (items: FaqEntry[]) => (
    <ul className="space-y-2">
      {items.map((entry) => (
        <FaqItem
          key={entry.id}
          entry={entry}
          open={openId === entry.id}
          onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
        />
      ))}
    </ul>
  );

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
      <div className="mt-4 space-y-5">
        {grouped
          ? categories.map((c) => (
              <section key={c} aria-label={t(FAQ_CATEGORY_KEY[c])}>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-label">{t(FAQ_CATEGORY_KEY[c])}</h4>
                {list(entries.filter((e) => e.category === c))}
              </section>
            ))
          : list(entries)}
      </div>
    </Card>
  );
}

function FaqItem({ entry, open, onToggle }: { entry: FaqEntry; open: boolean; onToggle: () => void }) {
  const { locale } = useLocale();
  const { question, answer } = faqText(entry, locale);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex w-full items-start justify-between gap-2 rounded-xl border border-border/80 bg-surface px-3 py-3 text-left text-sm font-medium text-primary transition-colors hover:bg-background-2",
          open && "rounded-b-none border-b-0 bg-background-2",
        )}
      >
        <span>{question}</span>
        <ChevronDown
          className={cn("mt-0.5 h-4 w-4 shrink-0 text-label transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="whitespace-pre-wrap rounded-b-xl border border-t-0 border-border/80 bg-background-2/50 px-3 py-3 text-sm leading-relaxed text-primary/90">
          {answer}
        </div>
      ) : null}
    </li>
  );
}
