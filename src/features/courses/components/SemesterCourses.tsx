// "Also in semester N": the other courses of a semester the course is taught
// in, on its card, so a student can move between them without going back.
// The semester: your own program's (and entry year's) when the course is in
// it, else the first program that has it in a semester. The curriculum is
// the same query the Courses page uses (cached), ratings included.
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Card } from "@/shared/ui/Card";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { courseSlug, useCurriculum, useMyProgram, type CoursePlace } from "../api";
import { fill, kindKey } from "../labels";
import { RatingChip } from "./RatingChip";

/** The place to show: in your program (your entry year first), else the first in a semester. */
function pickPlace(places: CoursePlace[], mine?: { program_code: string; entry_year: number }): CoursePlace | undefined {
  const inSemester = places.filter((p) => p.semester > 0);
  if (mine) {
    const own = inSemester.filter((p) => p.program_code === mine.program_code);
    const best = own.find((p) => p.year === mine.entry_year) ?? own[0];
    if (best) return best;
  }
  return inSemester[0];
}

export function SemesterCourses({ code, places }: { code: string; places: CoursePlace[] }) {
  const { t } = useLocale();
  const { data: mine, isPending: minePending } = useMyProgram();
  const place = minePending ? undefined : pickPlace(places, mine ?? undefined);
  const { data: curriculum } = useCurriculum(place?.program_code, place?.year ?? 0, place?.track ?? "");
  // keepPreviousData may still hold another program's plan: use it only when it is this one.
  const sameCurriculum = curriculum && place && curriculum.program_code === place.program_code && curriculum.year === place.year;
  const semester = sameCurriculum ? curriculum.semesters.find((s) => s.number === place.semester) : undefined;
  if (!place || !semester || semester.items.length < 2) return null;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-label">{fill(t("courseSameSemester"), { n: place.semester })}</h2>
          <p className="text-xs text-label">
            {place.program_title} · {place.lang} ({place.program_code}) · {place.year}
          </p>
        </div>
        <Link
          to={`/courses?program=${place.program_code}&year=${place.year}&track=${encodeURIComponent(place.track)}&sem=${place.semester}`}
          viewTransition
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline dark:text-primary"
        >
          {t("courseOpenSemester")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
        {semester.items.map((item, i) => {
          // This course, as a fixed course or as one of a slot's options.
          const here = item.course?.code === code || Boolean(item.options?.some((o) => o.code === code));
          const rating = item.course ? curriculum?.ratings?.[item.course.code] : undefined;
          return (
            <li
              key={i}
              aria-current={here ? "true" : undefined}
              className={cn("flex items-center gap-3 px-3 py-2 text-sm", here ? "bg-background-2" : "bg-surface")}
            >
              <span className="w-[4.5rem] shrink-0 font-mono text-xs font-semibold text-label">{item.course ? item.course.code : item.kind || "—"}</span>
              <span className="min-w-0 flex-1">
                {item.course && !here ? (
                  <Link to={`/courses/${courseSlug(item.course.code)}`} viewTransition className="font-medium text-primary hover:underline">
                    {item.course.name || item.course.code}
                  </Link>
                ) : (
                  <span className={cn("font-medium", here ? "text-primary" : "text-label")}>
                    {item.course ? item.course.name || item.course.code : item.label}
                    {!item.course && item.kind ? <span className="ml-1.5 text-xs font-normal">· {t(kindKey(item.kind))}</span> : null}
                  </span>
                )}
                {here ? <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">{t("courseCurrent")}</span> : null}
              </span>
              {rating && rating.count > 0 ? <RatingChip rating={rating} className="hidden sm:inline-flex" /> : null}
              <span className="shrink-0 text-xs text-label">{fill(t("coursesEcts"), { n: item.ects })}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
