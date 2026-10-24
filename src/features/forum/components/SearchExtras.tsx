import { faqText } from "@/entities/faq";
import { useFaqs } from "@/features/faq/api";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { highlight, matchesWords } from "@/shared/lib/highlight";
import { Button } from "@/shared/ui/Button";
import { BookOpen, ChevronDown, MessageSquarePlus, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const MAX_FAQ_MATCHES = 3;

/** FAQ entries that match the forum search, shown above the forum results. */
export function FaqSearchMatches({ words }: { words: string[] }) {
  const { t, locale } = useLocale();
  const { data: entries = [] } = useFaqs();
  const [openId, setOpenId] = useState<string | null>(null);
  if (words.length === 0) return null;
  const matches = entries
    .map((e) => ({ id: e.id, ...faqText(e, locale) }))
    .filter((e) => matchesWords(e.question, words) || matchesWords(e.answer, words))
    .slice(0, MAX_FAQ_MATCHES);
  if (matches.length === 0) return null;

  return (
    <section className="mb-4 rounded-xl border border-border/60 bg-background-2/40 p-3" aria-label={t("searchFaqMatches")}>
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-label">
        <BookOpen className="h-3.5 w-3.5" aria-hidden />
        {t("searchFaqMatches")}
      </h2>
      <ul className="space-y-1">
        {matches.map((m) => {
          const open = openId === m.id;
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : m.id)}
                className="flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-primary hover:bg-surface"
              >
                <span>{highlight(m.question, words)}</span>
                <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-label transition-transform", open && "rotate-180")} aria-hidden />
              </button>
              {open ? <p className="whitespace-pre-wrap px-2 pb-2 text-sm text-primary/85">{highlight(m.answer, words)}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * "Didn't find it?" under a search: ask the AI, or ask the forum. Both start
 * with the search text filled in, not sent, so it can be edited first.
 */
export function SearchHelp({ q, onAskForum }: { q: string; onAskForum: () => void }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
      <p className="mr-auto text-sm text-label">{t("searchNotFoundQuestion")}</p>
      <Button size="sm" variant="secondary" onClick={() => navigate("/chat", { state: { draftQuery: q }, viewTransition: true })}>
        <Sparkles className="h-4 w-4" />
        {t("searchAskAi")}
      </Button>
      <Button size="sm" onClick={onAskForum}>
        <MessageSquarePlus className="h-4 w-4" />
        {t("searchAskForum")}
      </Button>
    </div>
  );
}
