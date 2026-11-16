// Reads a curriculum page of the SDU portal in the browser, from a saved page
// (Ctrl+S, .htm) or from pasted text (Ctrl+A, Ctrl+C), and keeps only lines
// that are certainly part of a curriculum. Nothing else on the page (the
// admin's name, photo, ID, IP, advisor, last login, menus) is ever sent.
//
// Two layers:
// 1. A saved page is read by its structure: only the program title block, the
//    curriculum table (#tblMufredatProg), "TOTAL ECTS" and the "ELECTIVE
//    COURSES" block. The rest of the page is never even read.
// 2. Every line, from a page or a paste, must match a strict pattern: the
//    title, a track with the word "Track" (or the title block's own track), a
//    level word, a semester number, "Total ects: N", one of the five elective
//    headings, or a complete course row whose code uses a real SDU prefix and
//    whose name has no e-mail, long number or IP address. A line that starts
//    like a row but fails is not sent: it comes back in `unreadable`, is shown
//    to the admin on their own screen, and the import is held back.

export interface PortalCurriculum {
  /** The lines to send to the server ("" when the page can't be used). */
  text: string;
  /** Row-like lines that could not be read: shown locally, never sent. */
  unreadable: string[];
  /** Why nothing can be sent: no program title, or no valid track/level under it. */
  problem?: "no_header" | "odd_header";
}

/** Course prefixes of the SDU departments (portal: Curricula → departments), and XXX placeholders. */
const PREFIXES = new Set([
  "EXT", "CSS", "CYB", "HOF", "INF", "MAT", "MCM", "MMS", "SDS", "SOE",
  "BIO", "BIR", "CHE", "EDU", "FFA", "FPH", "HPE", "IBCTL", "KZL", "KZP", "PED", "PHT", "PHY", "PRE", "PRI", "PSY", "RLL", "SPS", "TFL", "TRA",
  "ACC", "ECO", "EUR", "FIN", "HIS", "HSS", "IRN", "JSC", "JUR", "LAW", "MAN", "MAR", "PSYC", "RUS",
  "CEC", "MDE", "FOU", "PDI", "XXX",
]);

const HEADER = /^\d{4}-\d{5} [\p{L}\p{N} ()&,.:'’/+–-]{1,150} \([A-Z]{2}\)$/u;
const SEMESTER = /^\d{1,2}$/;
const TOTAL = /^total ects: ?\d{1,3}$/i;
const ELECTIVES = /^elective courses$/i;
const SECTION = /^(AE - Area elective|NAE - Non-area elective|NTE - Non Theoretical Elective|RC - Requisite Courses|SA - Social Activities)$/i;
/** A complete row (spaces squeezed): №, code, name, theory, practice "2+0", hours, ECTS. */
const ROW = /^\d{1,3} ?\*? ([A-Za-z]{3,5}) ?[0-9Xx]{3,4} (.+?) \d{1,2} \d{1,2}\+\d{1,2} \d{1,2} \d{1,2}$/;
/** Anything that starts with a row number and has more on the line: a row, or reported. */
const ROW_LIKE = /^\d{1,3} ?\*? \S+ \S/;
/** What a course name must not contain: an e-mail, a long number (an ID, a phone), an IP address. */
const NOT_A_NAME = /@|\d{5,}|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
const TRACK_CHARS = /^[\p{L}][\p{L}\p{N} ()&,./+–-]{0,79}$/u;
const LEVEL = /^(bachelor|master|doctoral|phd)$/i;

function isRow(line: string): boolean {
  const m = ROW.exec(line);
  return Boolean(m && PREFIXES.has(m[1].toUpperCase()) && !NOT_A_NAME.test(m[2]));
}

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SELECT", "OPTION", "BUTTON", "TEMPLATE", "TEXTAREA", "IMG", "SVG", "HEAD", "INPUT"]);
const BLOCK = new Set([
  "DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL", "FORM", "CENTER", "TABLE", "TBODY", "THEAD",
  "TFOOT", "TR", "TD", "TH", "SECTION", "HEADER", "FOOTER", "NAV", "MAIN", "BR", "ARTICLE", "ASIDE",
]);

/** An element's text with line breaks: <br> and blocks start new lines. */
function textOf(node: Node, br = " "): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return "";
  if (tag === "BR") return br;
  let s = "";
  for (const c of Array.from(el.childNodes)) s += textOf(c, br) + (BLOCK.has(c.nodeName.toUpperCase()) ? br : "");
  return s;
}

/**
 * Lines in reading order, the way a browser copies: a table row without
 * tables inside is one line with its cells separated by tabs.
 */
function flatten(node: Node, out: string[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    out[out.length - 1] += node.textContent ?? "";
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag)) return;
  if (tag === "TR" && !el.querySelector("table")) {
    const cells = Array.from(el.children)
      .filter((c) => ["TD", "TH"].includes(c.tagName.toUpperCase()))
      .map((c) => textOf(c).replace(/\s+/g, " ").trim());
    out.push(cells.join("\t"), "");
    return;
  }
  const block = BLOCK.has(tag);
  if (block) out.push("");
  for (const c of Array.from(el.childNodes)) flatten(c, out);
  if (block) out.push("");
}

/** Cyrillic letters that look like Latin ones (the same list as the backend's CleanText). */
const LOOKALIKES: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X",
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x",
};

/**
 * In words that are otherwise Latin or digits, Cyrillic look-alikes become
 * Latin: the portal has typos like "PED 4ХХ" (Cyrillic Х) and "Кazakh".
 * Real Kazakh/Russian words stay as they are.
 */
function latinLookalikes(line: string): string {
  return line.replace(/\S+/g, (word) => {
    const cyrillic = word.match(/[Ѐ-ӿ]/g) ?? [];
    if (cyrillic.length === 0 || !/[A-Za-z0-9]/.test(word) || cyrillic.some((ch) => !(ch in LOOKALIKES))) return word;
    return word.replace(/[Ѐ-ӿ]/g, (ch) => LOOKALIKES[ch] ?? ch);
  });
}

/** One line with all spaces (tabs too) squeezed and look-alike letters fixed: what the patterns check, and what is sent. */
const squeeze = (line: string) => latinLookalikes(line.replace(/ /g, " ").replace(/\s+/g, " ").trim());

/**
 * Keeps only certain curriculum lines. `trustedTrack`: the line after the
 * title is the track from the page's title block (a saved page), not just
 * the next line of a paste.
 */
export function curriculumText(rawLines: string[], trustedTrack = false): PortalCurriculum {
  const lines = rawLines.map(squeeze).filter(Boolean);
  const start = lines.findIndex((l) => HEADER.test(l));
  if (start < 0) return { text: "", unreadable: [], problem: "no_header" };

  // Under the title: the track, then the level ("Bachelor"). Anything else there: stop, send nothing.
  let i = start + 1;
  const track = lines[i] ?? "";
  const trackOk = TRACK_CHARS.test(track) && !LEVEL.test(track) && (trustedTrack || /\btrack\b/i.test(track));
  if (!trackOk) return { text: "", unreadable: [], problem: "odd_header" };
  i += 1;
  const kept = [lines[start], track];
  if (lines[i] && LEVEL.test(lines[i])) {
    kept.push(lines[i]);
    i += 1;
  }

  const unreadable: string[] = [];
  for (; i < lines.length; i += 1) {
    const l = lines[i];
    if (HEADER.test(l) || SEMESTER.test(l) || TOTAL.test(l) || ELECTIVES.test(l) || SECTION.test(l) || isRow(l)) {
      kept.push(l);
    } else if (ROW_LIKE.test(l)) {
      unreadable.push(l);
    }
  }
  return { text: kept.join("\n") + "\n", unreadable };
}

/** Curriculum lines from pasted text (Ctrl+A, Ctrl+C on the portal page). */
export function curriculumFromPaste(text: string): PortalCurriculum {
  return curriculumText(text.split(/\r?\n/));
}

/**
 * The curriculum parts of a saved page, read by structure: the title block
 * and the semesters (the form around #tblMufredatProg), "TOTAL ECTS", and the
 * "ELECTIVE COURSES" block. null when the page doesn't have that structure.
 */
function structuredLines(doc: Document): string[] | null {
  const plan = doc.getElementById("tblMufredatProg");
  const form = plan?.closest("form");
  const h3 = form?.querySelector("h3");
  if (!plan || !form || !h3) return null;
  // Title and track: the two lines of the title block.
  const lines = textOf(h3, "\n").split("\n").map(squeeze).filter(Boolean);
  // The level: the small table between the title and the semesters.
  for (const table of Array.from(form.querySelectorAll("table"))) {
    if (table === plan || plan.contains(table) || table.contains(plan)) continue;
    lines.push(...textOf(table, "\n").split("\n").map(squeeze).filter(Boolean));
    break;
  }
  const out = [""];
  flatten(plan, out);
  lines.push(...out);
  const divs = Array.from(doc.querySelectorAll("div"));
  const total = divs.find((d) => TOTAL.test(squeeze(d.textContent ?? "")));
  if (total) lines.push(squeeze(total.textContent ?? ""));
  const heading = divs.find((d) => ELECTIVES.test(squeeze(d.textContent ?? "")));
  if (heading?.parentElement) {
    const rest = [""];
    flatten(heading.parentElement, rest);
    lines.push(...rest);
  }
  return lines;
}

/** Curriculum lines from a saved page's HTML (by structure; by lines when the structure is unknown). */
export function curriculumFromHtml(html: string): PortalCurriculum {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const structured = structuredLines(doc);
  if (structured) return curriculumText(structured, true);
  const out = [""];
  flatten(doc.body, out);
  return curriculumText(out);
}

/** Reads a saved .htm page in its own encoding (the portal saves UTF-8, but older saves may differ). */
export async function curriculumFromFile(file: File): Promise<PortalCurriculum> {
  const bytes = await file.arrayBuffer();
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
  const charset = /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  let html: string;
  try {
    html = new TextDecoder(charset).decode(bytes);
  } catch {
    html = new TextDecoder("utf-8").decode(bytes);
  }
  return curriculumFromHtml(html);
}
