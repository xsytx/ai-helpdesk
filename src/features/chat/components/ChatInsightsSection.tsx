import { insightToFaqDraft, useChatInsights, type InsightKind } from "@/features/chat/insights";
import type { FaqDraft } from "@/features/faq/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { BookPlus } from "lucide-react";
import { useState } from "react";

const KINDS: { kind: InsightKind; label: TranslationKey; hint: TranslationKey }[] = [
  { kind: "disliked", label: "insightsDisliked", hint: "insightsDislikedHint" },
  { kind: "unanswered", label: "insightsUnanswered", hint: "insightsUnansweredHint" },
  { kind: "frequent", label: "insightsFrequent", hint: "insightsFrequentHint" },
];

/**
 * Admin panel section: what students ask the AI that the FAQ should answer
 * (👎 answers, questions the AI couldn't answer, questions many students
 * ask), from the last 30 days, without names. "Make it an FAQ" opens the
 * FAQ editor with the question filled in.
 */
export function ChatInsightsSection({ onMakeFaq }: { onMakeFaq: (draft: FaqDraft) => void }) {
  const { t, plural, locale } = useLocale();
  const [kind, setKind] = useState<InsightKind>("disliked");
  const { data: items = [], isPending, isError } = useChatInsights(kind);
  const current = KINDS.find((k) => k.kind === kind)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="tab"
            aria-selected={kind === k.kind}
            onClick={() => setKind(k.kind)}
            className={cn(
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              kind === k.kind ? "bg-brand text-white" : "bg-surface text-primary hover:bg-background-2",
            )}
          >
            {t(k.label)}
          </button>
        ))}
      </div>
      <p className="text-sm text-label">{t(current.hint)}</p>

      {isPending ? <p className="text-sm text-label">{t("loading")}</p> : null}
      {isError ? <p className="text-sm text-error">{t("insightsLoadFailed")}</p> : null}
      {!isPending && !isError && items.length === 0 ? <p className="text-sm text-label">{t("moderationEmpty")}</p> : null}

      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={`${item.at}-${i}`} className="rounded-2xl border border-surface/60 bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-label">
                  {formatRelativeTime(item.at, locale)}
                  {kind === "frequent" ? ` · ${plural(item.students, "insightsStudents")}` : ""}
                </p>
                {item.context ? (
                  <p className="mt-1 line-clamp-2 text-xs text-label">
                    {t("insightsEarlier")}: {item.context}
                  </p>
                ) : null}
                <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-primary">{item.question || "—"}</p>
                {item.answer && kind !== "frequent" ? (
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-label">
                    <span className="font-semibold">AI: </span>
                    {item.answer}
                  </p>
                ) : null}
              </div>
              <Button size="sm" variant="secondary" disabled={!item.question} onClick={() => onMakeFaq(insightToFaqDraft(item, kind))}>
                <BookPlus className="h-4 w-4" />
                {t("insightsMakeFaq")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
