// Room codes and places mentioned in a text (a question to the AI assistant or
// its answer), for the "Show on map" buttons under an answer. Matching is done
// here in the website: the AI model is not involved, so it can't slow down or
// change the answers.
import type { Locale } from "@/i18n/translations";
import { PLACES, parseRoomCode, type Place } from "./places";

export type MapTarget =
  | { kind: "room"; code: string; label: string; to: string }
  | { kind: "place"; code: string; label: string; to: string };

const LETTER = /[\p{L}\p{N}]/u;
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/**
 * Does `text` mention `term`? At a word start; one-word terms of 5+ letters
 * also match their word forms ("столовая" → "столовую", "библиотеке").
 */
function mentions(text: string, term: string): boolean {
  const t = norm(term).trim();
  if (t.length < 3) return false;
  const oneWord = /^\p{L}+$/u.test(t);
  const stem = oneWord && t.length >= 6 ? t.slice(0, -2) : oneWord && t.length === 5 ? t.slice(0, -1) : t;
  let from = 0;
  for (;;) {
    const i = text.indexOf(stem, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : text[i - 1];
    const after = text[i + stem.length] ?? "";
    const startOk = !before || !LETTER.test(before);
    // A short or multi-word term must end at a word end too ("ssc" not in "sscx").
    const endOk = stem !== t ? true : !after || !LETTER.test(after);
    if (startOk && endOk) return true;
    from = i + 1;
  }
}

/** Words that make a question about where something is (any of the three languages). */
const WHERE = [
  "where", "located", "location", "how to get", "how do i get to", "how can i get to", "how to find", "how do i find", "on the map", "which floor",
  "где", "находится", "как пройти", "как дойти", "как найти", "на карте", "какой этаж", "каком этаже",
  "қайда", "орналасқан", "қалай баруға", "қалай табуға", "картада", "қай қабат",
];

/**
 * Up to `max` rooms and places the text talks about: room codes always; a
 * place only when the text asks where something is (aliases like "food" or
 * "documents" are too general otherwise). Names count before aliases.
 */
export function findMapTargets(raw: string, locale: Locale, max = 2): MapTarget[] {
  const text = norm(raw);
  const asksWhere = WHERE.some((w) => text.includes(w));
  const out: MapTarget[] = [];
  const seen = new Set<string>();
  const add = (t: MapTarget) => {
    if (seen.has(t.code) || out.length >= max) return;
    seen.add(t.code);
    out.push(t);
  };

  // Room codes: "F205"/"f205" (blocks A–I), or with a space or dash "F 205" /
  // "F-205" (capital A–H only: "I 100% agree" is not room I100).
  for (const m of raw.matchAll(/(?<![\p{L}\p{N}])(?:([A-Ia-i])|([A-H])[ -])(\d{3})(?![\p{N}%])/gu)) {
    const room = parseRoomCode(`${m[1] ?? m[2]}${m[3]}`);
    if (room) add({ kind: "room", code: room.code, label: room.code, to: `/navigation?q=${encodeURIComponent(room.code)}` });
  }

  if (!asksWhere) return out;
  const toPlace = (p: Place): MapTarget => ({ kind: "place", code: p.code, label: p.name[locale], to: `/navigation?place=${encodeURIComponent(p.code)}` });
  const byCode = (code: string) => PLACES.find((p) => p.code === code);

  // A lecture hall by its letter: "Bochka A", "бочку C", "D бочка".
  const hall = /(?:bochk\p{L}*|боч\p{L}*)\s*[«"“]?([abcd])(?!\p{L})|(?<!\p{L})([abcd])[»"”]?\s*(?:bochk|боч)/u.exec(text);
  const hallPlace = hall ? byCode(`HALL_${(hall[1] ?? hall[2]).toUpperCase()}`) : undefined;
  if (hallPlace) add(toPlace(hallPlace));

  // Names (in any language) are surer than aliases; popular places win ties.
  const byPopular = [...PLACES].sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)));
  for (const p of byPopular) {
    if ([p.name.en, p.name.ru, p.name.kz].some((n) => mentions(text, n))) add(toPlace(p));
  }
  // Aliases: one place per word ("canteen" is the Red Canteen, not every canteen).
  const usedWords = new Set<string>();
  for (const p of byPopular) {
    // Block and lecture-hall aliases are too general ("block", "bochka" without a letter).
    if (p.kind === "block" || p.code.startsWith("HALL_")) continue;
    const word = p.aliases.find((a) => a.length >= 3 && !usedWords.has(a) && mentions(text, a));
    if (!word) continue;
    for (const a of p.aliases) if (mentions(text, a)) usedWords.add(a);
    add(toPlace(p));
  }
  return out;
}
