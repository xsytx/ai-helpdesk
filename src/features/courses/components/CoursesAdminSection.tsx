// Admin panel → "Courses": import a program's curriculum pasted from the SDU
// portal (check it first, then import; importing the same program, year and
// track again replaces it), the list of imported curricula, and course
// descriptions in three languages.
import { useLocale } from "@/i18n/LocaleContext";
import { getErrorData, getErrorStatus } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Check, ClipboardPaste, FileCode2, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  courseSlug, useCourseSearch, useCurricula, useDeleteCurriculum, useImportCurriculum, usePreviewCurriculum, useUpdateCourse,
  type Course, type CurriculumPreview,
} from "../api";
import { fill, importErrorKey } from "../labels";
import { curriculumFromFile, curriculumFromPaste } from "../portalPage";
import { DescriptionsImport } from "./DescriptionsImport";

const field = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-brand";

export function CoursesAdminSection() {
  return (
    <div className="space-y-6">
      <SavedPagesImport />
      <ImportBox />
      <ImportedList />
      <DescriptionEditor />
      <DescriptionsImport />
    </div>
  );
}

type PreviewSemester = CurriculumPreview["semesters"][number];
const semesterEcts = (s: PreviewSemester) => s.items.reduce((n, it) => n + (it.course?.ects ?? it.slot?.ects ?? 0), 0);

function summary(p: CurriculumPreview) {
  let courses = 0;
  let slots = 0;
  for (const s of p.semesters) {
    for (const it of s.items) {
      if (it.course) courses++;
      else if (it.slot) slots++;
    }
  }
  return { courses, slots, ects: p.semesters.reduce((n, s) => n + semesterEcts(s), 0), semesters: p.semesters.length };
}

/** Why this checked curriculum can't be imported (the server refuses it too), or undefined. */
function problemOf(p: CurriculumPreview): string | undefined {
  if (p.warnings.length > 0) return "unreadable_rows";
  if (p.semesters.some((s) => s.items.length === 0)) return "empty_semester";
  if (p.semesters.some((s) => s.expected_ects > 0 && semesterEcts(s) !== s.expected_ects)) return "ects_mismatch";
  const total = p.semesters.reduce((n, s) => n + semesterEcts(s), 0);
  if (p.expected_ects > 0 && total !== p.expected_ects) return "ects_mismatch";
  return undefined;
}

/** What a check found: the program, semesters with their ECTS against the page's totals, unreadable rows. */
function PreviewCard({ p }: { p: CurriculumPreview }) {
  const { t } = useLocale();
  const sum = summary(p);
  const problem = problemOf(p);
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-background-2/50 p-3 text-sm">
      <p className="font-semibold text-primary">
        {p.year}-{p.program_code} {p.title} ({p.lang}) · {p.track} · {p.level}
      </p>
      <p className="text-label">
        {fill(t("coursesAdminSummary"), sum)}
        {p.expected_ects > 0 ? ` · ${fill(t("coursesAdminEctsCheck"), { sum: sum.ects, expected: p.expected_ects })}` : ""}
      </p>
      <ul className="flex flex-wrap gap-1.5 text-xs">
        {p.semesters.map((s) => {
          const off = s.items.length === 0 || (s.expected_ects > 0 && semesterEcts(s) !== s.expected_ects);
          return (
            <li key={s.number} className={cn("rounded-lg px-2 py-1", off ? "bg-red-50 text-red-800" : "bg-surface text-primary")}>
              {fill(t("coursesSemester"), { n: s.number })}: {s.items.length} · {semesterEcts(s)}
              {s.expected_ects > 0 && off ? `/${s.expected_ects}` : ""} ECTS
            </li>
          );
        })}
        {Object.entries(p.electives).map(([k, list]) => (
          <li key={k} className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {k}: {list.length}
          </li>
        ))}
      </ul>
      {problem ? <p className="text-xs text-error">{t(importErrorKey(problem))}</p> : null}
      {p.warnings.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 font-mono text-xs text-error">
          {p.warnings.slice(0, 20).map((w, i) => (
            <li key={i} className="break-all">{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Rows that look like courses but couldn't be read: shown to the admin here, never sent. */
function LocalUnreadable({ lines }: { lines: string[] }) {
  const { t } = useLocale();
  if (lines.length === 0) return null;
  return (
    <div className="rounded-xl bg-red-50 p-2.5 text-xs text-red-800">
      <p className="font-semibold">{t("coursesErrUnreadableRows")}</p>
      <p className="mt-0.5">{t("coursesAdminLocalOnly")}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono">
        {lines.slice(0, 20).map((l, i) => (
          <li key={i} className="break-all">{l}</li>
        ))}
      </ul>
    </div>
  );
}

function ImportBox() {
  const { t } = useLocale();
  const [text, setText] = useState("");
  const preview = usePreviewCurriculum();
  const importer = useImportCurriculum();
  const [problem, setProblem] = useState<string>();
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const failed = (err: unknown) =>
    setProblem(getErrorStatus(err) === 422 ? t(importErrorKey(getErrorData(err)?.code)) : t("coursesAdminFailed"));
  // Only certain curriculum lines leave the browser (see portalPage.ts).
  const send = (run: typeof preview.mutate | typeof importer.mutate) => {
    const read = curriculumFromPaste(text);
    setUnreadable(read.unreadable);
    if (read.problem) {
      setProblem(t(importErrorKey(read.problem)));
      return;
    }
    run(read.text, { onError: failed, onSuccess: () => setProblem(undefined) });
  };
  const p = preview.data;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
        <ClipboardPaste className="h-4 w-4" />
        {t("coursesAdminPaste")}
      </h2>
      <p className="text-sm text-label">{t("coursesAdminIntro")}</p>
      <p className="flex items-start gap-1.5 text-xs text-label">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-700" />
        {t("coursesAdminPrivacy")}
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          preview.reset();
          importer.reset();
          setProblem(undefined);
          setUnreadable([]);
        }}
        rows={6}
        spellCheck={false}
        placeholder="2026-10101 Mathematics (EN)&#10;Main Track&#10;Bachelor&#10;1&#10;1  MAT 101  Mathematical analysis 1  2  2+0  4  5"
        className={cn(field, "resize-y font-mono text-xs")}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!text.trim() || preview.isPending} onClick={() => send(preview.mutate)}>
          <Check className="h-4 w-4" />
          {t("coursesAdminPreview")}
        </Button>
        <Button size="sm" disabled={!p || importer.isPending || Boolean(problemOf(p)) || unreadable.length > 0} onClick={() => send(importer.mutate)}>
          <Upload className="h-4 w-4" />
          {t("coursesAdminImport")}
        </Button>
      </div>
      {problem ? <p className="text-sm text-error" role="alert">{problem}</p> : null}
      <LocalUnreadable lines={unreadable} />
      {importer.data ? (
        <p className="text-sm text-green-700" role="status">
          {fill(t("coursesAdminImported"), { title: `${importer.data.program_title} (${importer.data.lang})`, year: importer.data.year, track: importer.data.track })}{" "}
          <Link to={`/courses?program=${importer.data.program_code}&year=${importer.data.year}`} className="font-semibold underline">
            {t("courses")}
          </Link>
        </p>
      ) : p ? (
        <PreviewCard p={p} />
      ) : null}
    </section>
  );
}

interface SavedPage {
  key: string;
  name: string;
  /** The curriculum lines read from the page in the browser (only these are sent). */
  text: string;
  /** Course-like lines that could not be read: shown here, never sent. */
  unreadable: string[];
  status: "checking" | "ready" | "problem" | "importing" | "imported";
  preview?: CurriculumPreview;
  error?: string;
}

/**
 * Saved portal pages (Ctrl+S, .htm): each is read in the browser (only the
 * curriculum lines are kept), checked on the server, then the ready ones are
 * imported one by one.
 */
function SavedPagesImport() {
  const { t } = useLocale();
  const preview = usePreviewCurriculum();
  const importer = useImportCurriculum();
  const input = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<SavedPage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  // "Clear" starts a new batch: files still being checked from the old one are dropped.
  const batch = useRef(0);
  // Files already taken, by name, size and date (picked twice = checked once).
  const taken = useRef(new Set<string>());
  const update = (key: string, patch: Partial<SavedPage>) => setPages((all) => all.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const errorText = (err: unknown) =>
    getErrorStatus(err) === 422 ? t(importErrorKey(getErrorData(err)?.code)) : t("coursesAdminFailed");

  const add = async (files: File[]) => {
    const mine = batch.current;
    const fresh = files.filter((f) => /\.html?$/i.test(f.name));
    for (const file of fresh) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (taken.current.has(key)) continue;
      taken.current.add(key);
      setPages((all) => [...all, { key, name: file.name, text: "", unreadable: [], status: "checking" }]);
      const read = await curriculumFromFile(file).catch(() => ({ text: "", unreadable: [], problem: "no_header" as const }));
      if (batch.current !== mine) return;
      update(key, { text: read.text, unreadable: read.unreadable });
      if (read.problem) {
        update(key, { status: "problem", error: t(importErrorKey(read.problem)) });
        continue;
      }
      try {
        const p = await preview.mutateAsync(read.text);
        if (batch.current !== mine) return;
        const problem = read.unreadable.length > 0 ? "unreadable_rows" : problemOf(p);
        update(key, { preview: p, status: problem ? "problem" : "ready", error: problem ? t(importErrorKey(problem)) : undefined });
      } catch (err) {
        if (batch.current !== mine) return;
        update(key, { status: "problem", error: errorText(err) });
      }
    }
  };
  const clear = () => {
    batch.current += 1;
    taken.current = new Set();
    setPages([]);
  };

  const importAll = async () => {
    setRunning(true);
    for (const page of pages.filter((p) => p.status === "ready")) {
      update(page.key, { status: "importing" });
      try {
        await importer.mutateAsync(page.text);
        update(page.key, { status: "imported" });
      } catch (err) {
        update(page.key, { status: "problem", error: errorText(err) });
      }
    }
    setRunning(false);
  };

  const ready = pages.filter((p) => p.status === "ready").length;
  const statusText: Record<SavedPage["status"], string> = {
    checking: t("coursesAdminFileChecking"),
    ready: t("coursesAdminFileReady"),
    problem: "",
    importing: t("coursesAdminFileImporting"),
    imported: t("coursesAdminFileImported"),
  };

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
        <FileCode2 className="h-4 w-4" />
        {t("coursesAdminFiles")}
      </h2>
      <p className="text-sm text-label">{t("coursesAdminFilesHint")}</p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!running) void add(Array.from(e.dataTransfer.files));
        }}
        className={cn("flex flex-col items-center gap-1.5 rounded-xl border border-dashed p-4 text-center", dragging ? "border-brand bg-background-2" : "border-border")}
      >
        <Button size="sm" variant="secondary" disabled={running} onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" />
          {t("coursesAdminChooseFiles")}
        </Button>
        <span className="text-xs text-label">{t("coursesAdminDropFiles")}</span>
        <input
          ref={input}
          type="file"
          accept=".htm,.html,text/html"
          multiple
          hidden
          onChange={(e) => {
            void add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {pages.length > 0 ? (
        <ul className="space-y-2">
          {pages.map((page) => (
            <li key={page.key} className="rounded-2xl border border-border/60 p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-label" title={page.name}>{page.name}</span>
                {page.preview ? (
                  <span className="font-semibold text-primary">
                    {page.preview.title} ({page.preview.lang}) · {page.preview.year}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    page.status === "imported" || page.status === "ready" ? "bg-green-50 text-green-700" : page.status === "problem" ? "bg-red-50 text-red-800" : "bg-background-2 text-label",
                  )}
                >
                  {page.status === "problem" ? "!" : statusText[page.status]}
                </span>
              </div>
              {page.error ? <p className="mt-1 text-xs text-error">{page.error}</p> : null}
              <LocalUnreadable lines={page.unreadable} />
              {page.preview && page.status === "problem" ? <div className="mt-2"><PreviewCard p={page.preview} /></div> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {pages.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={running || ready === 0} onClick={() => void importAll()}>
            <Upload className="h-4 w-4" />
            {fill(t("coursesAdminImportAll"), { n: ready })}
          </Button>
          <Button size="sm" variant="ghost" disabled={running} onClick={clear}>
            {t("mapBulkClear")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ImportedList() {
  const { t, locale } = useLocale();
  const { data, isPending } = useCurricula();
  const remove = useDeleteCurriculum();
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-primary">{t("coursesAdminList")}</h2>
      {isPending ? <p className="text-sm text-label">{t("loading")}</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-label">{t("coursesAdminNone")}</p> : null}
      <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
        {data?.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Link to={`/courses?program=${c.program_code}&year=${c.year}&track=${encodeURIComponent(c.track)}`} className="min-w-0 flex-1 text-primary hover:underline">
              <b>{c.program_title}</b> · {c.lang} · {c.year} · {c.track}
              <span className="block text-xs text-label">
                {c.program_code} · {fill(t("coursesAdminCourses"), { n: c.courses })} · {formatRelativeTime(c.imported_at, locale)}
              </span>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 px-0"
              aria-label={t("coursesAdminDelete")}
              title={t("coursesAdminDelete")}
              disabled={remove.isPending}
              onClick={() => window.confirm(t("coursesAdminDeleteConfirm")) && remove.mutate(c.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DescriptionEditor() {
  const { t } = useLocale();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const { data: results } = useCourseSearch(debounced);
  const [picked, setPicked] = useState<Course>();

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-primary">{t("coursesAdminDescriptions")}</h2>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-1">
        <Search className="h-4 w-4 shrink-0 text-label" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("coursesAdminFindCourse")}
          aria-label={t("coursesAdminFindCourse")}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-primary outline-none placeholder:text-label/70"
        />
      </div>
      {debounced.trim().length >= 2 && results && results.length > 0 && !picked ? (
        <ul className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/60">
          {results.map((c) => (
            <li key={c.code}>
              <button type="button" onClick={() => setPicked(c)} className="flex w-full gap-3 px-3 py-1.5 text-left text-sm hover:bg-background-2">
                <span className="w-[4.5rem] shrink-0 font-mono text-xs font-semibold text-label">{c.code}</span>
                <span className="text-primary">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {picked ? <DescriptionForm key={picked.code} course={picked} onClose={() => setPicked(undefined)} /> : null}
    </section>
  );
}

/** The three descriptions of a course (admin panel, and on the course card for staff). */
export function DescriptionForm({ course, onClose, onCard = false }: { course: Course; onClose: () => void; onCard?: boolean }) {
  const { t } = useLocale();
  const save = useUpdateCourse();
  const [en, setEn] = useState(course.description);
  const [kz, setKz] = useState(course.description_kz);
  const [ru, setRu] = useState(course.description_ru);
  return (
    <form
      className="space-y-2 rounded-2xl border border-border bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        // On the card the form closes once saved: the new text shows in its place.
        save.mutate({ code: course.code, description: en, description_kz: kz, description_ru: ru }, { onSuccess: () => onCard && onClose() });
      }}
    >
      {onCard ? null : (
        <p className="font-semibold text-primary">
          <Link to={`/courses/${courseSlug(course.code)}`} className="hover:underline">
            {course.code} · {course.name}
          </Link>
        </p>
      )}
      {([
        [t("coursesAdminDescEn"), en, setEn],
        [t("coursesAdminDescKz"), kz, setKz],
        [t("coursesAdminDescRu"), ru, setRu],
      ] as const).map(([label, value, setValue]) => (
        <label key={label} className="block text-xs font-semibold text-label">
          {label}
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={3000} className={cn(field, "mt-1 resize-y")} />
        </label>
      ))}
      {save.isError ? <p className="text-sm text-error">{t("coursesAdminFailed")}</p> : null}
      {save.isSuccess ? <p className="text-sm text-green-700" role="status">{t("coursesAdminSaved")}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          <Check className="h-4 w-4" />
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </form>
  );
}
