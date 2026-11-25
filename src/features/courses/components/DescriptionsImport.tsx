// Admin panel → Courses → "Import descriptions": many courses' descriptions
// at once from a spreadsheet (see descriptionsCsv.ts). The file is read in the
// browser and shown first; "Import" then saves each course through the same
// endpoint as the description form, one by one, keeping texts the file leaves empty.
import { useLocale } from "@/i18n/LocaleContext";
import { apiClient, getErrorStatus } from "@/shared/api/client";
import { Button } from "@/shared/ui/Button";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { courseSlug, type CourseDetail } from "../api";
import { readDescriptionsCsv, type DescriptionRow } from "../descriptionsCsv";
import { fill } from "../labels";

type Result = { saved: number; missing: string[]; failed: string[] };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The backend allows about 2 saves a second (bursts of 20): on "too many
 * requests" wait and try again, so a long file is paced instead of failing.
 * Also used for importing many saved curriculum pages.
 */
export async function paced<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (getErrorStatus(err) !== 429 || attempt >= 8) throw err;
      await wait(700 * (attempt + 1));
    }
  }
}

export function DescriptionsImport() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<DescriptionRow[]>();
  const [fileName, setFileName] = useState("");
  const [problem, setProblem] = useState<string>();
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result>();

  const pick = async (file: File) => {
    setResult(undefined);
    setDone(0);
    setFileName(file.name);
    const read = readDescriptionsCsv(await file.text());
    if ("error" in read) {
      setRows(undefined);
      setProblem(t(read.error === "noCode" ? "coursesDescImportNoCode" : "coursesDescImportNoText"));
      return;
    }
    setProblem(read.rows.length ? undefined : t("coursesDescImportEmpty"));
    setRows(read.rows);
  };

  const run = async () => {
    if (!rows) return;
    setRunning(true);
    const out: Result = { saved: 0, missing: [], failed: [] };
    for (const [i, r] of rows.entries()) {
      const slug = encodeURIComponent(courseSlug(r.code));
      try {
        // An empty cell keeps what is saved: start from the course's current texts.
        const { data: c } = await apiClient.get<CourseDetail>(`/courses/${slug}`);
        await paced(() =>
          apiClient.put(`/admin/courses/${slug}`, {
            description: r.en || c.description,
            description_kz: r.kz || c.description_kz,
            description_ru: r.ru || c.description_ru,
          }),
        );
        out.saved++;
      } catch (err) {
        (getErrorStatus(err) === 404 ? out.missing : out.failed).push(r.code);
      }
      setDone(i + 1);
    }
    await queryClient.invalidateQueries({ queryKey: ["courses"] });
    setResult(out);
    setRunning(false);
  };

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
        <FileSpreadsheet className="h-4 w-4" />
        {t("coursesDescImport")}
      </h2>
      <p className="text-xs text-label">{t("coursesDescImportHint")}</p>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={running} onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4" />
          {t("coursesDescImportChoose")}
        </Button>
        {fileName ? <span className="text-xs text-label">{fileName}</span> : null}
      </div>
      {problem ? <p className="text-sm text-error">{problem}</p> : null}

      {rows && rows.length > 0 && !result ? (
        <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
          <p className="text-sm text-primary">{fill(t("coursesDescImportFound"), { n: rows.length })}</p>
          <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto text-xs">
            {rows.map((r) => (
              <li key={r.code} className="flex gap-3 py-1">
                <span className="w-[4.5rem] shrink-0 font-mono font-semibold text-label">{r.code}</span>
                <span className="min-w-0 truncate text-primary">{r.en || r.ru || r.kz}</span>
                <span className="ml-auto shrink-0 text-label">{[r.en && "EN", r.kz && "KZ", r.ru && "RU"].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" disabled={running} onClick={() => void run()}>
            {running ? fill(t("coursesDescImportProgress"), { done, n: rows.length }) : t("coursesDescImportRun")}
          </Button>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-1 rounded-2xl border border-border bg-surface p-3 text-sm" role="status">
          <p className="font-semibold text-green-700">{fill(t("coursesDescImportSaved"), { n: result.saved })}</p>
          {result.missing.length ? (
            <p className="text-xs text-label">{fill(t("coursesDescImportMissing"), { codes: result.missing.join(", ") })}</p>
          ) : null}
          {result.failed.length ? (
            <p className="text-xs text-error">{fill(t("coursesDescImportFailed"), { codes: result.failed.join(", ") })}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
