import { FAQ_CATEGORIES, faqText, type FaqCategory, type FaqEntry } from "@/entities/faq";
import { useFaqs } from "@/features/faq/api";
import { FAQ_CATEGORY_KEY } from "@/features/faq/categories";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Zap } from "lucide-react";
import { useState } from "react";

interface FaqQuickRepliesProps {
  onSelect: (entry: FaqEntry) => void;
  disabled?: boolean;
  /** Hide the "Popular questions" heading (when a toggle above already names it). */
  hideTitle?: boolean;
}

/**
 * The FAQ questions admins marked "In chat", as buttons answered instantly
 * from the FAQ (no AI). With entries in several categories, chips above
 * filter them.
 */
export function FaqQuickReplies({ onSelect, disabled = false, hideTitle = false }: FaqQuickRepliesProps) {
  const { t, locale } = useLocale();
  const { data: entries = [] } = useFaqs();
  const [category, setCategory] = useState<FaqCategory | "all">("all");

  const pinned = entries.filter((e) => e.pinned);
  if (pinned.length === 0) return null;
  const categories = FAQ_CATEGORIES.filter((c) => pinned.some((e) => e.category === c));
  const shown = category === "all" ? pinned : pinned.filter((e) => e.category === category);

  return (
    <div className="mt-3">
      {hideTitle ? null : (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-label">{t("chatQuickQuestions")}</p>
      )}
      {categories.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label={t("faqCategoryLabel")}>
          {(["all", ...categories] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                category === c ? "bg-brand text-white" : "text-label hover:bg-background-2 hover:text-primary",
              )}
            >
              {c === "all" ? t("faqAllCategories") : t(FAQ_CATEGORY_KEY[c])}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {shown.map((entry) => (
          <button
            key={entry.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(entry)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background-2 px-3 py-1.5 text-left text-xs font-medium text-primary hover:bg-background-2-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Zap className="h-3 w-3 shrink-0 text-accent" aria-hidden />
            {faqText(entry, locale).question}
          </button>
        ))}
      </div>
    </div>
  );
}
