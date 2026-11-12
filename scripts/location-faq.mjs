// Writes the AI's location facts from the Maps page data, so the AI chat and
// the map never disagree about where a place is. It replaces the LOC_* rows of
// ai_ml/data/raw/faq.csv (all other rows stay) with a "Where is …?" question
// and answer per place in English, Russian and Kazakh, short everyday
// questions for the most-asked places, and the room code rule.
//
//   node scripts/location-faq.mjs
//   docker compose run --rm -v "<repo>/ai_ml/data:/app/data" ai_ml python -m kb.cli index
//   docker compose up -d --build ai_ml
//
// (The ai_ml image carries its own copy of data/, so the index is rebuilt with
// the real folder mounted and then the image is rebuilt.)
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [path.join(root, "src/features/locations/places.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  alias: { "@": path.join(root, "src") },
  logLevel: "error",
});
const { PLACES } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const csv = (s) => `"${String(s).replace(/"/g, '""')}"`;
const category = "Campus navigation/Навигация по кампусу/Кампус навигациясы";
const today = new Date().toISOString().slice(0, 10);
const rows = [];
const add = (id, lang, question, answer) =>
  rows.push([id, lang, question, answer, "verified", "Generated from the Maps page data (src/features/locations/places.ts)", "", "", "", today, category, lang, "maps", answer, "", "", ""].map(csv).join(","));

const LANGS = ["en", "ru", "kk"];
const text = (t, lang) => (lang === "kk" ? t.kz : t[lang]);
const extra = (p, lang) =>
  [
    p.hours ? { en: `Hours: ${p.hours}.`, ru: `Часы работы: ${p.hours}.`, kk: `Жұмыс уақыты: ${p.hours}.` }[lang] : "",
    p.contact ? { en: `Contact: ${p.contact}.`, ru: `Контакты: ${p.contact}.`, kk: `Байланыс: ${p.contact}.` }[lang] : "",
  ].filter(Boolean).join(" ");
const seeMap = {
  en: "Search it on the Maps page for the route and the exact spot.",
  ru: "Найдите на странице «Карты» — там маршрут и точное место.",
  kk: "«Карталар» бетінен іздеңіз — онда жол мен нақты орны бар.",
};
const answer = (p, lang) => `${text(p.name, lang)}: ${text(p.where, lang)}. ${extra(p, lang)} ${seeMap[lang]}`.replace(/\.\./g, ".").replace(/\s+/g, " ").trim();

for (const p of PLACES) {
  if (/not on the plan/.test(p.where.en)) continue;
  const q = { en: `Where is the ${p.name.en}?`, ru: `Где находится ${p.name.ru}?`, kk: `${p.name.kz} қайда орналасқан?` };
  for (const lang of LANGS) add(`LOC_${p.code}_${lang}`, lang, q[lang], answer(p, lang));
}

// The short everyday questions students type ("Где библиотека?", "SSC қайда?").
const SHORT = {
  SSC: ["Where is the SSC?", "Где находится SSC?", "SSC қайда?"],
  LIBRARY: ["Where is the library?", "Где библиотека?", "Кітапхана қайда?"],
  RED_CANTEEN: ["Where is the canteen?", "Где столовая?", "Асхана қайда?"],
  MEDICAL: ["Where is the medical point?", "Где медпункт?", "Медпункт қайда?"],
  SDU_LIFE: ["Where is the gym?", "Где спортзал?", "Спортзал қайда?"],
  DORM: ["Where is the dorm?", "Где общежитие?", "Жатақхана қайда?"],
  ADVISING: ["Where is the advising desk?", "Где эдвайзинг?", "Эдвайзинг қайда?"],
};
for (const [code, questions] of Object.entries(SHORT)) {
  const p = PLACES.find((x) => x.code === code);
  if (!p) throw new Error(`No place ${code} in places.ts`);
  LANGS.forEach((lang, i) => add(`LOC_${code}_SHORT_${lang}`, lang, questions[i], answer(p, lang)));
}

const RULE = {
  en: ["How do room numbers like F205 work?", "The letter is the block, the first digit is the floor and the last two are the room: F205 = block F, floor 2, room 05. In the wings, rooms 01–06 are in the left part (floors 1–3) and rooms 07 and up in the right part, which has floors 1–4 at half-levels: its floor 3 is between floors 2 and 3 of the left part, its floor 4 a little above floor 3 of the left part."],
  ru: ["Как читать номер аудитории, например F205?", "Буква — блок, первая цифра — этаж, последние две — аудитория: F205 = блок F, 2 этаж, аудитория 05. В крыльях аудитории 01–06 — в левой части (этажи 1–3), а 07 и дальше — в правой части, где этажи 1–4 идут полуэтажами: её 3 этаж — между 2 и 3 этажами левой части, 4 этаж — чуть выше 3 этажа левой части."],
  kk: ["F205 сияқты аудитория нөмірін қалай түсінуге болады?", "Әріп — блок, бірінші цифр — қабат, соңғы екеуі — аудитория: F205 = F блогы, 2-қабат, 05 аудитория. Қанаттарда 01–06 аудиториялар сол жақта (1–3 қабат), ал 07 және одан жоғары — оң жақта, онда 1–4 қабат жартылай деңгейде: оның 3-қабаты сол жақтың 2 және 3-қабаттарының ортасында, 4-қабаты сол жақтың 3-қабатынан сәл жоғары."],
};
for (const lang of LANGS) add(`LOC_ROOMCODES_${lang}`, lang, RULE[lang][0], RULE[lang][1]);

// Keep every other row as it is; replace only the generated ones.
const file = path.join(root, "ai_ml/data/raw/faq.csv");
const original = readFileSync(file, "utf8");
const marker = original.search(/^"LOC_/m);
const kept = marker >= 0 ? original.slice(0, marker) : original.endsWith("\n") ? original : original + "\r\n";
writeFileSync(file, kept + rows.join("\r\n") + "\r\n", "utf8");
console.log(`faq.csv: ${rows.length} location rows written.`);
