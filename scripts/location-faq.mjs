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
  en: ["How do room numbers like F205 work?", "The letter is the block, the first digit is the floor and the last two are the room: F205 = block F, floor 2, room 05. The wings D–I are split-level, so floor 3 has two parts: 3A is the right part of the wing (F306 and up) and 3B the left part (F301–F305). Floor 4 (F4xx) is only in the right part of the wing."],
  ru: ["Как читать номер аудитории, например F205?", "Буква — блок, первая цифра — этаж, последние две — аудитория: F205 = блок F, 2 этаж, аудитория 05. Крылья D–I двухуровневые, поэтому 3 этаж состоит из двух частей: 3A — правая часть крыла (F306 и дальше), 3B — левая часть (F301–F305). 4 этаж (F4xx) есть только в правой части крыла."],
  kk: ["F205 сияқты аудитория нөмірін қалай түсінуге болады?", "Әріп — блок, бірінші цифр — қабат, соңғы екеуі — аудитория: F205 = F блогы, 2-қабат, 05 аудитория. D–I қанаттары екі деңгейлі, сондықтан 3-қабат екі бөліктен тұрады: 3A — қанаттың оң жағы (F306 және одан кейін), 3B — сол жағы (F301–F305). 4-қабат (F4xx) тек қанаттың оң жағында."],
};
for (const lang of LANGS) add(`LOC_ROOMCODES_${lang}`, lang, RULE[lang][0], RULE[lang][1]);

// Getting upstairs in the wings (the elevators and stairs are map points;
// the route on the Maps page marks them).
const LIFT_ANSWER = {
  en: "Every wing D–I has an elevator in its corridor that stops at floors 1, 2, 3A, 3B and 4. By stairs: the stairs at the far end of each wing go to every floor; from floor 2, the stairs near the wing entrance (Stairs 2-3A-3B) go to 3A and 3B; from 3B, Stairs 3B-4 go to floor 4. The route on the Maps page marks the elevator and the stairs.",
  ru: "В каждом крыле D–I в коридоре есть лифт, он останавливается на этажах 1, 2, 3A, 3B и 4. По лестнице: лестница в дальнем конце крыла ведёт на все этажи; со 2 этажа на 3A и 3B ведёт лестница у входа в крыло (Stairs 2-3A-3B); с 3B на 4 этаж — лестница Stairs 3B-4. Маршрут на странице «Карты» отмечает лифт и лестницу.",
  kk: "D–I қанаттарының әрқайсысының дәлізінде лифт бар, ол 1, 2, 3A, 3B және 4-қабаттарда тоқтайды. Баспалдақпен: қанаттың ең соңындағы баспалдақ барлық қабатқа апарады; 2-қабаттан 3A мен 3B-ға қанат кіреберісіне жақын баспалдақ (Stairs 2-3A-3B) апарады; 3B-дан 4-қабатқа Stairs 3B-4 баспалдағы апарады. «Карталар» бетіндегі жол лифт пен баспалдақты белгілейді.",
};
const LIFT_QUESTIONS = {
  en: ["How do I get to floor 3A, 3B or 4?", "Where is the elevator?"],
  ru: ["Как попасть на этаж 3A, 3B или 4?", "Где лифт?"],
  kk: ["3A, 3B немесе 4-қабатқа қалай жетуге болады?", "Лифт қайда?"],
};
for (const lang of LANGS) {
  add(`LOC_UPSTAIRS_${lang}`, lang, LIFT_QUESTIONS[lang][0], LIFT_ANSWER[lang]);
  add(`LOC_LIFT_SHORT_${lang}`, lang, LIFT_QUESTIONS[lang][1], LIFT_ANSWER[lang]);
}

// Keep every other row as it is; replace only the generated ones.
const file = path.join(root, "ai_ml/data/raw/faq.csv");
const original = readFileSync(file, "utf8");
const marker = original.search(/^"LOC_/m);
const kept = marker >= 0 ? original.slice(0, marker) : original.endsWith("\n") ? original : original + "\r\n";
writeFileSync(file, kept + rows.join("\r\n") + "\r\n", "utf8");
console.log(`faq.csv: ${rows.length} location rows written.`);
