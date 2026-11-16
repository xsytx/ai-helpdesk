// A course's card (story 16): code, name, credits and hours, the description,
// and every program and semester where it is taught. Reviews (stories 17-18)
// come next on this page.
import { courseDescription, courseFromSlug, useCourse, type CoursePlace } from "@/features/courses/api";
import { useLocale } from "@/i18n/LocaleContext";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Mascot } from "@/shared/ui/Mascot";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { fill, kindKey, levelKey } from "@/features/courses/labels";

export function CoursePage() {
  const { t, locale } = useLocale();
  const { code: slug = "" } = useParams();
  const code = courseFromSlug(slug);
  const { data: course, isPending, isError } = useCourse(code);

  const back = (
    <Link to="/courses" viewTransition className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline dark:text-primary">
      <ArrowLeft className="h-4 w-4" />
      {t("courseBack")}
    </Link>
  );

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {back}
        <div className="h-48 animate-pulse rounded-2xl bg-background-2" />
      </div>
    );
  }
  if (isError || !course) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {back}
        <Card className="flex items-center gap-3 text-sm text-primary">
          <Mascot mood="sad" size="sm" />
          {t("courseNotFound")}
        </Card>
      </div>
    );
  }

  const description = courseDescription(course, locale);
  // One line per program/year/track; a course may sit in a semester and in a list.
  const groups = new Map<string, CoursePlace[]>();
  for (const p of course.places) {
    const key = `${p.program_code}|${p.year}|${p.track}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {back}
      <Card className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex h-16 min-w-16 shrink-0 items-center justify-center rounded-2xl bg-brand px-3 text-center font-mono text-sm font-bold leading-tight text-white">
            {course.code}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-primary">{course.name}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-medium">
              <span className="rounded-lg bg-background-2 px-2 py-1 text-primary">{fill(t("coursesEcts"), { n: course.ects })}</span>
              <span className="rounded-lg bg-background-2 px-2 py-1 text-primary">
                {fill(t("courseHoursDetail"), { t: course.theory, p: course.practice || "0", h: course.hours })}
              </span>
            </div>
          </div>
        </div>

        <p className={description ? "whitespace-pre-wrap text-sm text-primary" : "text-sm text-label"}>
          {description || t("courseNoDescription")}
        </p>

        <Button asChild size="sm" variant="secondary">
          <Link to={`/forum?q=${encodeURIComponent(course.code)}`} viewTransition>
            <MessagesSquare className="h-4 w-4" />
            {t("courseDiscuss")}
          </Link>
        </Button>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-label">{t("courseTaughtIn")}</h2>
        {groups.size === 0 ? (
          <p className="text-sm text-label">{t("courseNotTaught")}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {[...groups.values()].map((list) => {
              const p = list[0];
              return (
                <li key={`${p.program_code}-${p.year}-${p.track}`} className="py-2.5 text-sm">
                  <Link
                    to={`/courses?program=${p.program_code}&year=${p.year}&track=${encodeURIComponent(p.track)}&sem=${list.find((x) => x.semester > 0)?.semester ?? "all"}`}
                    viewTransition
                    className="font-semibold text-primary hover:underline"
                  >
                    {p.program_title} · {p.lang}
                  </Link>
                  <span className="text-label"> · {t(levelKey(p.level))} · {p.year}{p.track && !/^main/i.test(p.track) ? ` · ${p.track}` : ""}</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {list.map((x, i) => (
                      <span
                        key={i}
                        className={
                          x.kind
                            ? "rounded-lg bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                            : "rounded-lg bg-green-50 px-2 py-0.5 text-xs text-green-700"
                        }
                      >
                        {x.semester > 0 ? `${fill(t("coursesSemester"), { n: x.semester })} · ` : ""}
                        {x.kind ? (x.semester > 0 ? `${t(kindKey(x.kind))}${x.label ? ` (${x.label})` : ""}` : `${t("courseInList")}: ${t(kindKey(x.kind))}`) : t("courseRequired")}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
