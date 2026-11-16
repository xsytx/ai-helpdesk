// Display names for the Courses pages: schools, elective kinds, levels.
import type { TranslationKey } from "@/i18n/translations";

const FACULTY_KEY: Record<string, TranslationKey> = { F_ENG: "facultyEng", F_PHIL: "facultyPhil", F_LAW: "facultyLaw" };

/** A school's name in the reader's language (the portal's code if unknown). */
export const facultyName = (code: string, t: (k: TranslationKey) => string) => (FACULTY_KEY[code] ? t(FACULTY_KEY[code]) : code);

/** The parser's error codes (backend curricula.ParseError, ImportProblem) as messages. */
const IMPORT_ERROR_KEY: Record<string, TranslationKey> = {
  too_long: "coursesErrTooLong",
  no_header: "coursesErrNoHeader",
  no_semesters: "coursesErrNoSemesters",
  two_curricula: "coursesErrTwoCurricula",
  unreadable_rows: "coursesErrUnreadableRows",
  empty_semester: "coursesErrEmptySemester",
  duplicate_semester: "coursesErrDuplicateSemester",
  ects_mismatch: "coursesErrEctsMismatch",
  no_totals: "coursesErrNoTotals",
  odd_header: "coursesErrOddHeader",
};
export const importErrorKey = (code: unknown): TranslationKey =>
  (typeof code === "string" && IMPORT_ERROR_KEY[code]) || "coursesAdminUnreadable";

const KIND_KEY: Record<string, TranslationKey> = {
  AE: "coursesKindAE",
  NAE: "coursesKindNAE",
  NTE: "coursesKindNTE",
  RC: "coursesKindRC",
  SA: "coursesKindSA",
};

/** An elective kind (AE, NAE…) as a translation key. */
export const kindKey = (kind: string): TranslationKey => KIND_KEY[kind] ?? "coursesKindOther";

/** A program level (B, M, DR, DS) as a translation key. */
export const levelKey = (level: string): TranslationKey =>
  level === "B" ? "coursesLevelB" : level === "M" ? "coursesLevelM" : "coursesLevelD";

/** "{n} ECTS" and the like. */
export const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
