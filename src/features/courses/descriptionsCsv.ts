// Course descriptions from a spreadsheet (admin panel → Courses → "Import
// descriptions"): a CSV with the columns code, description_en,
// description_kz, description_ru (others, like "name", are ignored). Excel
// saves CSV with a comma or, in Russian/Kazakh settings, a semicolon, and
// often with a BOM: both are handled. An empty cell keeps the text already saved.

export interface DescriptionRow {
  code: string;
  en: string;
  kz: string;
  ru: string;
}

/** Splits CSV text into rows of cells (quotes, "" inside quotes, line breaks inside quotes). */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** "css105" / "CSS  105" → "CSS 105". */
export const normalizeCode = (code: string) =>
  code.trim().toUpperCase().replace(/\s+/g, " ").replace(/^([A-Z]+)\s?(\d)/, "$1 $2");

/** The rows of the file, or an error key when its header has no code column or no description column. */
export function readDescriptionsCsv(text: string): { rows: DescriptionRow[] } | { error: "noCode" | "noDescriptions" } {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const [header = [], ...body] = parseCsv(clean, sep);
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const iCode = col("code");
  const iEn = col("description_en");
  const iKz = col("description_kz");
  const iRu = col("description_ru");
  if (iCode < 0) return { error: "noCode" };
  if (iEn < 0 && iKz < 0 && iRu < 0) return { error: "noDescriptions" };
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows = body
    .map((r) => ({ code: normalizeCode(at(r, iCode)), en: at(r, iEn), kz: at(r, iKz), ru: at(r, iRu) }))
    .filter((r) => r.code && (r.en || r.kz || r.ru));
  return { rows };
}
