// Place search on the Maps page, the same idea as the forum's search: every
// typed word must match a word of the place (its start, so "cante" finds
// "Canteen"), small typos are forgiven ("kanteen", "centre" = "center"),
// Russian/Kazakh endings too ("столовую", "библиотеке"), and filler words
// ("where", "где", "қайда") are ignored. Results are ranked: names before
// aliases before descriptions, exact before partial before typo.
import type { Place } from "./places";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
/** Words of a text: letters and digits only ("ssc(student" → "ssc", "student"). */
export const wordsOf = (s: string): string[] => norm(s).match(/[\p{L}\p{N}]+/gu) ?? [];
/** A place's words, plus dashed words written together ("Wi-Fi" is also "wifi"). */
const placeWords = (s: string): string[] => [...wordsOf(s), ...wordsOf(s.replace(/(?<=[\p{L}\p{N}])[-‐](?=[\p{L}\p{N}])/gu, "")).filter((w) => !wordsOf(s).includes(w))];

/** Words that only make a question ("where is the canteen") and never name a place. */
const FILLER = new Set([
  "where", "is", "the", "a", "an", "how", "to", "find", "get", "go", "of", "in", "at", "on", "me", "my", "i", "can", "do",
  "where's", "located", "which", "floor",
  "где", "находится", "как", "найти", "пройти", "дойти", "мне", "в", "на", "и", "у", "это", "можно", "этаж",
  "қайда", "орналасқан", "қалай", "табуға", "баруға", "бар", "ма", "ме", "қабат",
]);

/** Optimal string alignment distance (a swap of two letters counts as one), stopping above `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/** How well one typed word matches one word of a place: 4 exact … 0 not at all. */
function wordMatch(typed: string, word: string): number {
  if (typed === word) return 4;
  // One letter or digit ("Bochka A", "block F") only counts exactly.
  if (typed.length < 2) return 0;
  if (word.startsWith(typed)) return 3;
  // Word endings: "столовую" for "столовая", "библиотеке" for "библиотека".
  if (typed.length >= 5 && word.length >= 5) {
    const stem = Math.max(4, Math.min(typed.length, word.length) - 2);
    if (typed.slice(0, stem) === word.slice(0, stem)) return 2.5;
  }
  // Typos: one slip in a word of 4+ letters, two in 8+ ("kanteen", "libary", "centre").
  if (typed.length >= 4) {
    const max = typed.length >= 8 ? 2 : 1;
    if (distance(typed, word, max) <= max) return 2;
    // A typo inside a word still being typed: compare with the start of the word.
    if (word.length > typed.length && distance(typed, word.slice(0, typed.length), 1) <= 1) return 1.5;
  }
  return 0;
}

interface Indexed { place: Place; fields: { words: string[]; weight: number }[] }

function index(p: Place): Indexed {
  return {
    place: p,
    fields: [
      { words: placeWords([p.name.en, p.name.ru, p.name.kz].join(" ")), weight: 3 },
      { words: placeWords([...p.aliases, p.code.replace(/_/g, " "), ...(p.rooms ?? [])].join(" ")), weight: 2 },
      { words: placeWords([p.where.en, p.where.ru, p.where.kz].join(" ")), weight: 1 },
    ],
  };
}

/** The typed words that name something ("where is the canteen" → ["canteen"]). */
export function searchTerms(q: string): string[] {
  const all = wordsOf(q);
  const meaningful = all.filter((w) => !FILLER.has(w));
  return meaningful.length > 0 ? meaningful : all;
}

/**
 * Places matching the query, best first. Every word must match somewhere;
 * `extra` adds more places (the points admins keep on the floor plans).
 */
export function searchPlaces(q: string, places: Place[]): Place[] {
  const terms = searchTerms(q);
  if (terms.length === 0) return [];
  const scored: { place: Place; score: number }[] = [];
  for (const item of places.map(index)) {
    let total = 0;
    let all = true;
    for (const term of terms) {
      let best = 0;
      for (const field of item.fields) {
        for (const w of field.words) {
          const m = wordMatch(term, w);
          if (m > 0) best = Math.max(best, m * field.weight);
        }
      }
      if (best === 0) {
        all = false;
        break;
      }
      total += best;
    }
    if (all) scored.push({ place: item.place, score: total + (item.place.popular ? 0.5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.place);
}
