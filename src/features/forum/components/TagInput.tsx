import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Check } from "lucide-react";
import { FORUM_TAGS, MAX_TAGS, tagLabel } from "../tags";

/**
 * Choose a question's tags from the fixed list: tap to select, tap again to
 * unselect, at most MAX_TAGS.
 */
export function TagPicker({ id, tags, onChange }: { id: string; tags: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useLocale();
  const full = tags.length >= MAX_TAGS;
  return (
    <div className="space-y-1.5">
      <p id={id} className="text-sm font-medium text-label">
        {t("threadTagsLabel")}
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={id}>
        {FORUM_TAGS.map((tag) => {
          const selected = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={selected}
              disabled={!selected && full}
              onClick={() => onChange(selected ? tags.filter((x) => x !== tag) : [...tags, tag])}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                selected
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-white text-primary hover:bg-background-2",
              )}
            >
              {selected ? <Check className="h-3 w-3" aria-hidden /> : null}
              {tagLabel(tag, t)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-label">{t("threadTagsHint").replace("{n}", String(MAX_TAGS))}</p>
    </div>
  );
}

/** A tag as a small label, in the site language. */
export function TagChip({ tag, active = false }: { tag: string; active?: boolean }) {
  const { t } = useLocale();
  return (
    <span
      className={
        active
          ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-white"
          : "rounded-full bg-background-2 px-2.5 py-0.5 text-xs font-medium text-primary"
      }
    >
      {tagLabel(tag, t)}
    </span>
  );
}
