import type { ReactNode } from "react";

// Search-result highlighting. Same idea as the backend's prefix search: a
// typed word marks every word in the text that starts with it ("cante"
// marks "Canteen"), in any alphabet, ignoring case.

/** The words of a search, as the backend uses them (2+ letters). */
export function searchWords(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => [...w].length >= 2).slice(0, 8);
}

function wordStartRe(words: string[]): RegExp | null {
  if (words.length === 0) return null;
  const alternatives = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})[\\p{L}\\p{N}]*`, "giu");
}

/** text with the matching words wrapped in <mark>. */
export function highlight(text: string, words: string[]): ReactNode {
  const re = wordStartRe(words);
  if (!re) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <mark key={start} className="rounded bg-amber-100 px-0.5 text-inherit">
        {m[0]}
      </mark>,
    );
    last = start + m[0].length;
  }
  if (out.length === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Whether any of the words starts a word in text. */
export function matchesWords(text: string, words: string[]): boolean {
  const re = wordStartRe(words);
  return Boolean(re && re.test(text));
}

/**
 * A short piece of a long text around the first match, so a word found deep
 * in a question is visible in the list ("…is the canteen open on…").
 */
export function snippetAround(text: string, words: string[], radius = 80): string {
  const re = wordStartRe(words);
  const m = re ? re.exec(text) : null;
  if (!m || (m.index ?? 0) < radius) return text;
  const start = text.lastIndexOf(" ", (m.index ?? 0) - radius / 2);
  return `…${text.slice(start < 0 ? 0 : start + 1)}`;
}
