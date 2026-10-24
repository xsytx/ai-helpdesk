import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { useLocale } from "@/i18n/LocaleContext";
import { apiClient } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { plainText } from "@/shared/ui/RichText";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface UserSuggestion {
  id: number;
  display_name: string;
  avatar: string;
}

/** People whose name (a word of it) starts with q, for "@". */
function useUserSuggestions(q: string) {
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q), 150);
    return () => window.clearTimeout(timer);
  }, [q]);
  return useQuery({
    queryKey: ["users", "search", debounced],
    enabled: debounced.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get<{ users: UserSuggestion[] }>("/users/search", { params: { q: debounced } });
      return data.users;
    },
  });
}

// "@" + letters right before the caret, at the start or after a space.
const MENTION_QUERY = /(^|\s)@([\p{L}\p{N}._-]{1,30})$/u;
const STORED_MENTION = /@\[([^\]\n]{1,80})\]\(u(\d{1,18})\)/g;
// Room for the hidden ids that mentions add when the text is saved.
const MENTION_ROOM = 100;

type Mentions = Map<string, number>; // name -> user id

/** Saved form: each picked "@Name" becomes @[Name](u<id>) (the backend notifies them). */
function toStored(text: string, mentions: Mentions): string {
  if (mentions.size === 0) return text;
  const names = [...mentions.keys()].sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const rx = new RegExp(`@(${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  return text.replace(rx, (_, name: string) => `@[${name}](u${mentions.get(name)})`);
}

/** The people mentioned in a saved text (to edit it as plain "@Name"). */
function mentionsIn(stored: string): Mentions {
  const out: Mentions = new Map();
  for (const m of stored.matchAll(STORED_MENTION)) out.set(m[1]!, Number(m[2]));
  return out;
}

/**
 * The text box for a question or answer. Type "@" and a few letters to
 * mention someone: pick a name and it shows as "@Name"; when saved it carries
 * the person's id, is shown as a link and sends them a notification.
 * value/onChange are the saved form.
 */
export function PostEditor({
  id,
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength = 2000,
  ariaLabel,
  className,
  autoFocus = false,
}: {
  autoFocus?: boolean;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const { t } = useLocale();
  const ref = useRef<HTMLTextAreaElement>(null);
  const mentions = useRef<Mentions>(mentionsIn(value));
  const [text, setText] = useState(() => plainText(value));
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = useUserSuggestions(mention?.query ?? "");
  const people = mention ? (suggestions.data ?? []) : [];

  // The text was set from outside (cleared after posting, a new edit): show it.
  useEffect(() => {
    if (value === toStored(text, mentions.current)) return;
    mentions.current = mentionsIn(value);
    setText(plainText(value));
    // Only when the saved value changes from outside (not on every keystroke).
  }, [value]);

  // Opened for a reply: start typing after the "@Name ".
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  function update(next: string) {
    setText(next);
    onChange(toStored(next, mentions.current));
  }

  function findMention() {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const m = MENTION_QUERY.exec(el.value.slice(0, caret));
    setMention(m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null);
    setActive(0);
  }

  function pick(user: UserSuggestion) {
    const el = ref.current;
    if (!mention || !el) return;
    const name = user.display_name.replace(/[[\]\n]/g, "").trim().slice(0, 80);
    mentions.current.set(name, user.id);
    const insert = `@${name} `;
    const next = text.slice(0, mention.start) + insert + text.slice(el.selectionStart);
    update(next);
    setMention(null);
    const caret = mention.start + insert.length;
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!people.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : people.length - 1)) % people.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(people[active]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <textarea
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        value={text}
        rows={rows}
        maxLength={maxLength - MENTION_ROOM}
        placeholder={placeholder}
        onChange={(e) => {
          update(e.target.value);
          window.requestAnimationFrame(findMention);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") findMention();
        }}
        onClick={findMention}
        onBlur={() => window.setTimeout(() => setMention(null), 150)}
        className="block w-full resize-y rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      />
      {mention && (people.length > 0 || suggestions.isSuccess) ? (
        <ul
          role="listbox"
          aria-label={t("formatMention")}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {people.length === 0 ? (
            <li className="px-3 py-2 text-xs text-label">{t("mentionNobody")}</li>
          ) : (
            people.map((u, i) => (
              <li key={u.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(u)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-primary",
                    i === active ? "bg-background-2" : "hover:bg-background-2",
                  )}
                >
                  <UserAvatar userId={String(u.id)} name={u.display_name} avatar={u.avatar} className="h-6 w-6 text-[10px]" />
                  <span className="truncate">{u.display_name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      <p className="mt-1 text-[11px] text-label">{t("formatHint")}</p>
    </div>
  );
}
