import { useLocale } from "@/i18n/LocaleContext";
import { X } from "lucide-react";
import { useState } from "react";

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 30;

/** Same cleanup as the backend: lower case, no "#", no spaces around. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
}

/**
 * Tags as removable chips. Enter, comma or leaving the field turns the typed
 * text into a tag; Backspace in an empty field removes the last one.
 */
export function TagInput({ id, tags, onChange }: { id: string; tags: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useLocale();
  const [text, setText] = useState("");
  const full = tags.length >= MAX_TAGS;

  function commit(raw: string) {
    const next = [...tags];
    for (const part of raw.split(",")) {
      const tag = normalizeTag(part);
      if (tag && !next.includes(tag) && next.length < MAX_TAGS) next.push(tag);
    }
    onChange(next);
    setText("");
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-label">
        {t("threadTagsLabel")}
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-white px-2 py-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-background-2 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary">
            #{tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== tag))}
              className="rounded-full p-0.5 text-label hover:bg-white hover:text-primary"
              aria-label={`${t("removeTag")} #${tag}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          disabled={full}
          maxLength={MAX_TAG_LENGTH + 1}
          placeholder={tags.length === 0 ? t("threadTagsPlaceholder") : ""}
          onChange={(e) => {
            if (e.target.value.includes(",")) commit(e.target.value);
            else setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && !text && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => text && commit(text)}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm text-primary placeholder:text-grey focus:outline-none disabled:hidden"
        />
      </div>
      <p className="text-xs text-label">{t("threadTagsHint")}</p>
    </div>
  );
}

/** A tag that opens the forum filtered by it. */
export function TagChip({ tag, active = false }: { tag: string; active?: boolean }) {
  return (
    <span
      className={
        active
          ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-white"
          : "rounded-full bg-background-2 px-2.5 py-0.5 text-xs font-medium text-primary"
      }
    >
      #{tag}
    </span>
  );
}
