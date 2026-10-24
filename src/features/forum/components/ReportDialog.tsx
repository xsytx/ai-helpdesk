import { useReportPost, type ReportReason } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { CheckCircle2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const REASONS: { value: ReportReason; label: TranslationKey }[] = [
  { value: "spam", label: "reportReasonSpam" },
  { value: "rude", label: "reportReasonRude" },
  { value: "wrong", label: "reportReasonWrong" },
  { value: "other", label: "reportReasonOther" },
];

/** "Report" on a question or answer: a reason, optional details, sent to the moderators. */
export function ReportDialog({
  target,
  onClose,
}: {
  target: { kind: "thread" | "comment"; id: string };
  onClose: () => void;
}) {
  const { t } = useLocale();
  const report = useReportPost();
  const [reason, setReason] = useState<ReportReason>();
  const [details, setDetails] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setFailed(false);
    try {
      await report.mutateAsync({ ...target, reason, details });
    } catch {
      setFailed(true);
    }
  }

  // On <body>: the page area is its own layer (page transitions) and would trap it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand/30 dark:bg-black/60 p-4 sm:items-center">
      <div className="absolute inset-0" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="relative z-10 w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="report-title" className="text-lg font-bold text-primary">
            {target.kind === "thread" ? t("reportQuestion") : t("reportAnswer")}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-label hover:bg-background-2" aria-label={t("close")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {report.isSuccess ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" aria-hidden />
            <p className="text-sm text-primary">{t("reportThanks")}</p>
            <Button className="w-full" onClick={onClose}>
              {t("close")}
            </Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <p className="text-sm text-label">{t("reportWhy")}</p>
            <div className="space-y-1.5" role="radiogroup">
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm text-primary transition-colors",
                    reason === r.value ? "border-primary bg-background-2" : "border-border hover:bg-background-2/60",
                  )}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="accent-primary"
                  />
                  {t(r.label)}
                </label>
              ))}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={2}
              maxLength={400}
              placeholder={t("reportDetailsPlaceholder")}
              aria-label={t("reportDetailsPlaceholder")}
              className="w-full resize-none rounded-xl border border-border px-3 py-2 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            {failed ? <p className="text-sm text-error">{t("postActionFailed")}</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button type="submit" className="flex-1" disabled={!reason || report.isPending}>
                {t("reportSend")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
