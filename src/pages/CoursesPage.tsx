// Courses (Sprint 6, story 16): a program's courses by semester. Opens on the
// student's own program and current semester; other programs can be browsed;
// any course can be found by code or name. Each course links to its card.
import {
  courseSlug, currentSemester, useCourseSearch, useCurriculum, useMyProgram, useMyReviews, usePrograms, useSetMyProgram,
  type CourseRef, type CurriculumItem, type Program,
} from "@/features/courses/api";
import { facultyName, fill, kindKey, levelKey } from "@/features/courses/labels";
import { useAuth } from "@/app/AuthContext";
import { useLocale } from "@/i18n/LocaleContext";
import { isStaffRole } from "@/features/moderation/api";
import { cn } from "@/shared/lib/cn";
import { useIsPhone } from "@/shared/lib/media";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Mascot } from "@/shared/ui/Mascot";
import { PageSkeleton } from "@/shared/ui/Skeleton";
import { BookOpen, ChevronDown, GraduationCap, MessageSquareText, Search, Shuffle } from "lucide-react";
import { MyReviews } from "@/features/courses/components/MyReviews";
import { prefersReducedMotion } from "@/shared/lib/motion";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

export function CoursesPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data: myReviews } = useMyReviews();
  const { data: programs, isError: programsFailed } = usePrograms();
  const { data: mine, isPending: minePending } = useMyProgram();
  const [choosing, setChoosing] = useState(false);
  const [q, setQ] = useState("");

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true, preventScrollReset: true });
  };

  const browsing = params.get("program");
  const programCode = browsing ?? mine?.program_code;
  const program = programs?.find((p) => p.code === programCode);
  const isMine = Boolean(mine && programCode === mine.program_code);
  // The student's own entry year when that curriculum exists, else the newest.
  const askedYear = Number(params.get("year")) || (isMine ? mine!.entry_year : 0);
  const year = program && askedYear && program.years.includes(askedYear) ? askedYear : 0;
  const track = params.get("track") ?? "";
  const { data: loaded, isPending: loadedPending, isError: curriculumFailed } = useCurriculum(programCode, year, track);
  // While another program loads, the previous one is kept as a placeholder: don't show it under the new title.
  const stale = Boolean(loaded && loaded.program_code !== programCode);
  const curriculum = stale ? undefined : loaded;
  const curriculumPending = loadedPending || stale;

  const numbers = curriculum?.semesters.map((s) => s.number) ?? [];
  // The current semester, within the plan (a 4-semester master's plan never shows "semester 5").
  const nowSemester =
    isMine && mine && numbers.length > 0 ? Math.min(currentSemester(mine.entry_year), Math.max(...numbers)) : undefined;
  const asked = params.get("sem");
  const sem = asked && (asked === "all" || numbers.includes(Number(asked))) ? asked : nowSemester ? String(nowSemester) : "all";
  const shown = curriculum?.semesters.filter((s) => sem === "all" || String(s.number) === sem) ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <h1 className="flex items-center gap-2 text-xl font-bold text-primary">
          <GraduationCap className="h-6 w-6" />
          {t("courses")}
        </h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-label">{t("coursesSubtitle")}</p>
          {/* Jumps to your reviews at the bottom of the page. */}
          <a
            href="#my-reviews"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("my-reviews")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-primary hover:bg-background-2"
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            {t("profileReviewsTab")}
            {myReviews && myReviews.length > 0 ? <span className="rounded-full bg-brand px-1.5 text-[10px] text-white">{myReviews.length}</span> : null}
          </a>
        </div>
        <CourseSearch q={q} setQ={setQ} />
      </Card>

      {programsFailed ? <p className="text-sm text-error">{t("coursesLoadFailed")}</p> : null}

      {!minePending && programs && (choosing || (!mine && !browsing)) ? (
        <ProgramChooser
          programs={programs}
          initial={mine ?? undefined}
          onDone={(code) => {
            setChoosing(false);
            set({ program: null, year: null, track: null, sem: null });
            void code;
          }}
          onCancel={mine ? () => setChoosing(false) : undefined}
        />
      ) : null}

      {programCode && program && !choosing ? (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-primary">{program.title}</h2>
              <p className="mt-0.5 text-xs text-label">
                {[t(levelKey(program.level)) + (program.tag ? ` ${program.tag}` : ""), program.lang, facultyName(program.faculty, t), program.code]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {browsing && mine ? (
                <Button size="sm" variant="secondary" onClick={() => set({ program: null, year: null, track: null, sem: null })}>
                  {t("coursesBackToMine")}
                </Button>
              ) : null}
              <ProgramSwitcher programs={programs ?? []} current={programCode} onPick={(code) => set({ program: code, year: null, track: null, sem: "all" })} />
              {mine ? (
                <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
                  {t("coursesChangeProgram")}
                </Button>
              ) : null}
            </div>
          </div>

          {curriculum ? (
            <>
              {isMine && askedYear && curriculum.year !== askedYear ? (
                <p className="rounded-xl bg-background-2 px-3 py-2 text-xs text-label">
                  {fill(t("coursesOtherYear"), { year: curriculum.year, entry: askedYear })}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("coursesSemester").replace("{n}", "")}>
                  {[{ id: "all", label: t("coursesAllSemesters") }, ...curriculum.semesters.map((s) => ({ id: String(s.number), label: String(s.number) }))].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={sem === tab.id}
                      onClick={() => set({ sem: tab.id })}
                      className={cn(
                        "relative min-w-9 rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors",
                        sem === tab.id ? "border-brand bg-brand text-white" : "border-border bg-surface text-primary hover:bg-background-2",
                      )}
                    >
                      {tab.label}
                      {nowSemester && tab.id === String(nowSemester) ? (
                        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" aria-label={t("coursesNow")} />
                      ) : null}
                    </button>
                  ))}
                </div>
                {curriculum.tracks.length > 1 ? (
                  <select
                    value={curriculum.track}
                    onChange={(e) => set({ track: e.target.value })}
                    aria-label={t("coursesTrack")}
                    className="rounded-xl border border-border bg-surface px-2.5 py-1.5 text-sm text-primary"
                  >
                    {curriculum.tracks.map((tr) => (
                      <option key={tr} value={tr}>{tr}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-label">{curriculum.track} · {curriculum.year}</span>
                )}
              </div>

              <div className="space-y-5">
                {shown.map((s) => (
                  <section key={s.number}>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
                      {fill(t("coursesSemester"), { n: s.number })}
                      <span className="font-normal text-label">· {fill(t("coursesEcts"), { n: s.ects })}</span>
                      {nowSemester === s.number ? <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">{t("coursesNow")}</span> : null}
                    </h3>
                    <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
                      {s.items.map((it, i) => (
                        <ItemRow key={i} item={it} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              <ElectiveLists lists={curriculum.electives} />
            </>
          ) : curriculumPending ? (
            <PageSkeleton rows={2} title={false} />
          ) : curriculumFailed ? (
            <p className="text-sm text-error">{t("coursesLoadFailed")}</p>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl bg-background-2 p-4 text-sm text-primary">
              <Mascot mood="think" size="sm" />
              <div>
                <p>{t("coursesNoCurriculum")}</p>
                {isStaffRole(user?.role) ? (
                  <Link to="/admin?section=courses" className="text-sm font-semibold text-brand hover:underline dark:text-primary">
                    {t("coursesNoCurriculumAdmin")}
                  </Link>
                ) : null}
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {/* Every course you reviewed (only you see this: reviews are anonymous to others). */}
      <Card id="my-reviews" className="scroll-mt-20 space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-primary">
          <MessageSquareText className="h-5 w-5" />
          {t("profileReviewsTab")}
        </h2>
        <MyReviews />
      </Card>
    </div>
  );
}

function CourseLink({ course, className }: { course: CourseRef; className?: string }) {
  return (
    <Link to={`/courses/${courseSlug(course.code)}`} viewTransition className={cn("hover:underline", className)}>
      {course.name || course.code}
    </Link>
  );
}

function ItemRow({ item }: { item: CurriculumItem }) {
  const { t } = useLocale();
  if (item.course) {
    return (
      <li className="flex items-center gap-3 bg-surface px-3 py-2.5 text-sm">
        <span className="w-[4.5rem] shrink-0 font-mono text-xs font-semibold text-label">{item.course.code}</span>
        <CourseLink course={item.course} className="min-w-0 flex-1 font-medium text-primary" />
        <span className="shrink-0 text-xs text-label">{fill(t("coursesEcts"), { n: item.ects })}</span>
      </li>
    );
  }
  return (
    <li className="bg-amber-50/60 px-3 py-2.5 text-sm dark:bg-amber-950/20">
      <div className="flex items-center gap-3">
        <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-amber-800 dark:text-amber-300">{item.kind || "—"}</span>
        <span className="min-w-0 flex-1 font-medium text-primary">
          {item.label}
          <span className="ml-1.5 text-xs font-normal text-label">· {t(kindKey(item.kind ?? ""))}</span>
        </span>
        <span className="shrink-0 text-xs text-label">{fill(t("coursesEcts"), { n: item.ects })}</span>
      </div>
      {item.options && item.options.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:pl-[5.25rem]">
          <span className="text-xs text-label">{t("coursesElectivePick")}:</span>
          {item.options.map((o) =>
            o.name ? (
              <Link
                key={o.code}
                to={`/courses/${courseSlug(o.code)}`}
                viewTransition
                title={o.name}
                className="inline-flex max-w-full items-baseline rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-primary hover:bg-background-2"
              >
                <span className="shrink-0 font-mono font-semibold">{o.code}</span>
                <span className="ml-1 truncate text-label">{o.name}</span>
              </Link>
            ) : (
              <span key={o.code} className="rounded-full border border-dashed border-border px-2.5 py-0.5 font-mono text-xs font-semibold text-label">
                {o.code}
              </span>
            ),
          )}
        </div>
      ) : null}
    </li>
  );
}

function ElectiveLists({ lists }: { lists: Record<string, CourseRef[]> }) {
  const { t } = useLocale();
  const kinds = Object.keys(lists).filter((k) => lists[k].length > 0);
  if (kinds.length === 0) return null;
  return (
    <details className="group rounded-2xl border border-border/60">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold text-primary">
        {t("coursesElectiveLists")}
        <ChevronDown className="h-4 w-4 text-label transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-border/60 p-3">
        {kinds.map((k) => (
          <section key={k}>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-label">
              {k} · {t(kindKey(k))} ({lists[k].length})
            </h4>
            <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {lists[k].map((c) => (
                <li key={c.code} className="flex gap-2 text-sm">
                  <span className="w-[4.5rem] shrink-0 font-mono text-xs font-semibold leading-5 text-label">{c.code}</span>
                  <CourseLink course={c} className="min-w-0 text-primary" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

/** A program's line in lists: "Computer Science · EN (10107)". */
const programLabel = (p: Program) => `${p.title} · ${p.lang}${p.tag ? ` · ${p.tag}` : ""} (${p.code})`;

/**
 * Programs for a <select>: first those whose courses are added (a curriculum
 * was imported), then the rest grouped by level and school.
 */
function ProgramOptions({ programs }: { programs: Program[] }) {
  const { t } = useLocale();
  const groups = new Map<string, Program[]>();
  const ready = programs.filter((p) => p.years.length > 0);
  if (ready.length > 0) groups.set(t("coursesWithCourses"), ready);
  for (const p of programs) {
    if (p.years.length > 0) continue;
    const key = `${t(levelKey(p.level))} · ${facultyName(p.faculty, t)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return (
    <>
      {[...groups.entries()].map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map((p) => (
            <option key={p.code} value={p.code}>
              {programLabel(p)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function ProgramSwitcher({ programs, current, onPick }: { programs: Program[]; current: string; onPick: (code: string) => void }) {
  const { t } = useLocale();
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{t("coursesBrowse")}</span>
      <Shuffle className="pointer-events-none absolute left-2.5 h-4 w-4 text-label" />
      <select
        value=""
        onChange={(e) => e.target.value && e.target.value !== current && onPick(e.target.value)}
        className="h-9 max-w-[14rem] rounded-xl border border-border bg-surface pl-8 pr-2 text-sm font-semibold text-primary"
      >
        <option value="">{t("coursesBrowse")}</option>
        <ProgramOptions programs={programs} />
      </select>
    </label>
  );
}

function ProgramChooser({ programs, initial, onDone, onCancel }: {
  programs: Program[];
  initial?: { program_code: string; entry_year: number };
  onDone: (code: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useLocale();
  const save = useSetMyProgram();
  const now = new Date();
  // Before September, this year's first-years haven't started yet.
  const latest = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  // No future years: the newest is this autumn's first-years.
  const years = Array.from({ length: 7 }, (_, i) => latest - i);
  const [code, setCode] = useState(initial?.program_code ?? "");
  const [year, setYear] = useState(Math.min(initial?.entry_year ?? latest, latest));
  const field = "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-brand";
  // Typing finds a program by name or code (every word a word start): one tap picks it.
  const [find, setFind] = useState("");
  const found = useMemo(() => {
    const words = find.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return programs
      .filter((p) => {
        const hay = `${p.title} ${p.lang} ${p.tag} ${p.code}`.toLowerCase().split(/[\s()·,-]+/);
        return words.every((w) => hay.some((h) => h.startsWith(w)));
      })
      // Programs with courses added first.
      .sort((a, b) => Number(b.years.length > 0) - Number(a.years.length > 0))
      .slice(0, 8);
  }, [find, programs]);
  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <Mascot mood="happy" size="sm" />
        <div>
          <h2 className="font-semibold text-primary">{t("coursesChooseTitle")}</h2>
          <p className="text-sm text-label">{t("coursesChooseHint")}</p>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-brand">
          <Search className="h-4 w-4 shrink-0 text-label" />
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            maxLength={60}
            placeholder={t("coursesFindProgram")}
            aria-label={t("coursesFindProgram")}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-primary outline-none placeholder:text-label/70"
          />
        </div>
        {find.trim() ? (
          found.length > 0 ? (
            <ul className="mt-1.5 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
              {found.map((p) => (
                <li key={p.code}>
                  <button
                    type="button"
                    onClick={() => {
                      setCode(p.code);
                      setFind("");
                    }}
                    className="flex w-full items-center justify-between gap-2 bg-surface px-3 py-2 text-left text-sm text-primary hover:bg-background-2"
                  >
                    <span className="min-w-0">
                      <span className="block">{programLabel(p)}</span>
                      <span className="block text-xs text-label">{t(levelKey(p.level))} · {facultyName(p.faculty, t)}</span>
                    </span>
                    {p.years.length > 0 ? (
                      <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">{t("coursesWithCourses")}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-label">{t("coursesNoProgramFound")}</p>
          )
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="block text-xs font-semibold text-label">
          {t("coursesProgram")}
          <select value={code} onChange={(e) => setCode(e.target.value)} className={field}>
            <option value="">{t("coursesPickProgram")}</option>
            <ProgramOptions programs={programs} />
          </select>
        </label>
        <label className="block text-xs font-semibold text-label">
          {t("coursesEntryYear")}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={field}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>
      {save.isError ? <p className="text-sm text-error">{t("coursesAdminFailed")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!code || save.isPending}
          onClick={() => save.mutate({ program_code: code, entry_year: year }, { onSuccess: () => onDone(code) })}
        >
          <BookOpen className="h-4 w-4" />
          {t("coursesSaveProgram")}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** Search any course by code or name; results link to the course. */
function CourseSearch({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const { t } = useLocale();
  // The full hint doesn't fit a phone's box: a short one there.
  const hint = t(useIsPhone() ? "coursesSearchShort" : "coursesSearchPlaceholder");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const { data, isFetching } = useCourseSearch(debounced);
  const results = useMemo(() => (debounced.trim().length >= 2 ? (data ?? []) : []), [data, debounced]);
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 rounded-2xl border-2 border-primary/80 bg-surface px-3 py-1.5 focus-within:border-brand">
        <Search className="h-5 w-5 shrink-0 text-label" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          placeholder={hint}
          aria-label={t("coursesSearchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-base text-primary outline-none placeholder:text-label/70"
        />
      </div>
      {debounced.trim().length >= 2 ? (
        results.length > 0 ? (
          <ul className="mt-2 max-h-80 divide-y divide-border/60 overflow-y-auto rounded-2xl border border-border/60">
            {results.map((c) => (
              <li key={c.code}>
                <Link to={`/courses/${courseSlug(c.code)}`} viewTransition className="flex items-center gap-3 bg-surface px-3 py-2 text-sm hover:bg-background-2">
                  <span className="w-[4.5rem] shrink-0 font-mono text-xs font-semibold text-label">{c.code}</span>
                  <span className="min-w-0 flex-1 text-primary">{c.name}</span>
                  <span className="shrink-0 text-xs text-label">{fill(t("coursesEcts"), { n: c.ects })}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : !isFetching ? (
          <p className="mt-2 text-sm text-label">{fill(t("coursesSearchEmpty"), { q: debounced.trim() })}</p>
        ) : null
      ) : null}
    </div>
  );
}
