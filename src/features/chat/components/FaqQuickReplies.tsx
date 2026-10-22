import { useFaqs } from "@/features/chat/api";
import { useLocale } from "@/i18n/LocaleContext";

const MAX_CHIPS = 6;

interface FaqQuickRepliesProps {
  onSelect: (question: string) => void;
  disabled?: boolean;
}

/** Clickable FAQ questions (edited by admins). A click sends the question through the normal chat flow. */
export function FaqQuickReplies({ onSelect, disabled = false }: FaqQuickRepliesProps) {
  const { t } = useLocale();
  const { data: entries = [] } = useFaqs();

  if (entries.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-label">{t("chatQuickQuestions")}</p>
      <div className="flex flex-wrap gap-2">
        {entries.slice(0, MAX_CHIPS).map((entry) => (
          <button
            key={entry.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(entry.question)}
            className="rounded-full border border-border bg-background-2 px-3 py-1.5 text-left text-xs font-medium text-primary hover:bg-background-2-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {entry.question}
          </button>
        ))}
      </div>
    </div>
  );
}
