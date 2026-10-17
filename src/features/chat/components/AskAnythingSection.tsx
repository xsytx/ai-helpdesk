import { useLocale } from "@/i18n/LocaleContext";
import { Card } from "@/shared/ui/Card";
import { ArrowUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

export function AskAnythingSection() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const suggestions = [
    t("suggestionDean"),
    t("suggestionEcts"),
    t("suggestionSyllabus"),
  ] as const;

  function submit(value: string) {
    const q = value.trim();
    if (!q) return;
    navigate("/chat", { viewTransition: true, state: { initialQuery: q } });
  }

  return (
    <Card className="border-none bg-white shadow-sm" data-tour="ask">
      <h2 className="mb-4 text-xl font-bold text-primary">{t("askAnything")}</h2>
      <div className="relative">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("askPlaceholder")}
          rows={3}
          className="min-h-[88px] w-full resize-y rounded-2xl border border-border bg-white px-4 py-3 pr-14 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 md:min-h-[72px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(query);
            }
          }}
        />
        <button
          type="button"
          onClick={() => submit(query)}
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={t("send")}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => submit(label)}
            className="rounded-full border border-border bg-background-2 px-3 py-1.5 text-xs font-medium text-primary hover:bg-background-2-hover"
          >
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}
