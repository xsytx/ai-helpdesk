// Admin panel → Courses → "Courses without descriptions": the taught courses
// that still need a description, none at all first, then the ones most
// programs teach (most students open them). "Write" opens the description
// form; "Download as CSV" gives the list in the "Import descriptions" format,
// so the team can fill it in a spreadsheet and bring it back.
import { useLocale } from "@/i18n/LocaleContext";
import { Button } from "@/shared/ui/Button";
import { SkeletonList } from "@/shared/ui/Skeleton";
import { Download, FileQuestion, PenLine } from "lucide-react";
import { useState } from "react";
import { useCourse, useMissingDescriptions, type DescriptionGap } from "../api";
import { fill } from "../labels";
import { DescriptionForm } from "./CoursesAdminSection";

const PAGE = 20;

/** One CSV cell: quoted when it has a comma, quote or line break. */
const cell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The list as a CSV for "Import descriptions" (empty description cells: the import keeps saved texts). */
function downloadCsv(list: DescriptionGap[]) {
  const rows = [
    ["code", "name", "programs", "missing", "description_en", "description_kz", "description_ru"],
    ...list.map((c) => [c.code, c.name, String(c.programs), c.missing.join(" "), "", "", ""]),
  ];
  // BOM: Excel then reads Kazakh and Russian letters correctly.
  const text = String.fromCharCode(0xfeff) + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "courses-without-descriptions.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MissingDescriptions() {
  const { t } = useLocale();
  const { data, isPending, isError } = useMissingDescriptions();
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string>();

  if (isPending) return <SkeletonList rows={3} />;
  if (isError || !data) return <p className="text-sm text-error">{t("coursesLoadFailed")}</p>;
  const none = data.courses.filter((c) => c.missing.length === 3).length;

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
        <FileQuestion className="h-4 w-4" />
        {t("coursesMissingTitle")}
      </h2>
      {data.courses.length === 0 ? (
        <p className="text-sm text-label">{t("coursesMissingDone")}</p>
      ) : (
        <>
          <p className="text-sm text-label">{fill(t("coursesMissingSummary"), { n: data.courses.length, used: data.used, none })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => downloadCsv(data.courses)}>
              <Download className="h-4 w-4" />
              {t("coursesMissingCsv")}
            </Button>
            <span className="text-xs text-label">{t("coursesMissingCsvHint")}</span>
          </div>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
            {data.courses.slice(0, shown).map((c) => (
              <li key={c.code} className="bg-surface px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-[4.5rem] shrink-0 font-mono text-xs font-semibold text-label">{c.code}</span>
                  <span className="min-w-0 flex-1 text-primary">{c.name}</span>
                  <span className="text-xs text-label">{fill(t("coursesMissingPrograms"), { n: c.programs })}</span>
                  <span className="flex gap-1">
                    {c.missing.map((lang) => (
                      <span key={lang} className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        {lang}
                      </span>
                    ))}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.code ? undefined : c.code)}>
                    <PenLine className="h-4 w-4" />
                    {t("coursesMissingWrite")}
                  </Button>
                </div>
                {open === c.code ? <GapForm code={c.code} onClose={() => setOpen(undefined)} /> : null}
              </li>
            ))}
          </ul>
          {shown < data.courses.length ? (
            <Button size="sm" variant="ghost" onClick={() => setShown(shown + PAGE)}>
              {t("coursesMissingMore")} ({data.courses.length - shown})
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The description form with the texts already saved (a course may have one language of three). */
function GapForm({ code, onClose }: { code: string; onClose: () => void }) {
  const { data } = useCourse(code);
  if (!data) return <SkeletonList rows={1} />;
  return (
    <div className="mt-2">
      <DescriptionForm course={data} onClose={onClose} />
    </div>
  );
}
