import { useDeleteReportedPost, useDismissReport, useReports, type PostReport } from "@/features/moderation/reports";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

const REASON_LABEL: Record<string, TranslationKey> = {
  spam: "reportReasonSpam",
  rude: "reportReasonRude",
  wrong: "reportReasonWrong",
  other: "reportReasonOther",
};

/** "spam: details" -> the translated reason and the details. */
function useReason(raw: string) {
  const { t } = useLocale();
  const [code, ...rest] = raw.split(":");
  const key = REASON_LABEL[code!.trim()];
  if (!key) return { label: raw || "—", details: "" };
  return { label: t(key), details: rest.join(":").trim() };
}

/** Admin panel section: posts students reported, to delete or keep. */
export function ReportsSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const { data, isPending, isError } = useReports(status);

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist">
        {(["open", "resolved"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              status === s ? "bg-primary text-white" : "bg-white text-primary hover:bg-background-2",
            )}
          >
            {s === "open" ? t("reportsOpen") : t("reportsResolved")}
            {s === "open" && data && status === "open" ? ` (${data.total})` : ""}
          </button>
        ))}
      </div>
      <p className="text-sm text-label">{t("reportsHint")}</p>
      {isPending ? <p className="text-sm text-label">{t("loading")}</p> : null}
      {isError ? <p className="text-sm text-error">{t("insightsLoadFailed")}</p> : null}
      {data && data.reports.length === 0 ? <p className="text-sm text-label">{t("moderationEmpty")}</p> : null}
      <ul className="space-y-2">
        {data?.reports.map((r) => <ReportCard key={r.id} report={r} />)}
      </ul>
    </div>
  );
}

function ReportCard({ report }: { report: PostReport }) {
  const { t, locale } = useLocale();
  const reason = useReason(report.reason);
  const dismiss = useDismissReport();
  const remove = useDeleteReportedPost();
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const gone = report.preview === "[deleted]";
  const busy = dismiss.isPending || remove.isPending;
  const onError = () => setFailed(true);

  return (
    <li className="rounded-2xl border border-white/60 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">{reason.label}</span>
        <span className="rounded-full bg-background-2 px-2 py-0.5 text-primary">
          {report.targetType === "thread" ? t("moderationQuestion") : t("moderationAnswer")}
        </span>
        <span className="font-normal text-label">
          {report.reporterName} · {formatRelativeTime(report.createdAt, locale)}
        </span>
      </div>
      {reason.details ? <p className="mt-2 text-sm italic text-label">“{reason.details}”</p> : null}
      <p className={cn("mt-2 line-clamp-3 whitespace-pre-wrap text-sm", gone ? "text-label" : "text-primary")}>
        {gone ? t("reportPostGone") : report.preview}
      </p>
      {report.status === "open" ? (
        confirming ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-error/30 bg-error/5 p-3" role="alertdialog">
            <p className="mr-auto text-sm text-primary">
              {report.targetType === "thread" ? t("deleteThreadConfirm") : t("deleteAnswerConfirm")}
            </p>
            <Button size="sm" className="bg-error hover:bg-error/90" disabled={busy} onClick={() => remove.mutate(report, { onError })}>
              {t("postDelete")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {!gone && report.threadId !== "0" ? (
              <Button asChild size="sm" variant="ghost">
                <Link to={`/forum/${report.threadId}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  {t("reportOpenPost")}
                </Link>
              </Button>
            ) : null}
            {!gone ? (
              <Button size="sm" variant="secondary" className="text-error" disabled={busy} onClick={() => setConfirming(true)}>
                <Trash2 className="h-4 w-4" />
                {t("reportDeletePost")}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => dismiss.mutate(report.id, { onError })}>
              {gone ? t("reportClose") : t("reportKeepPost")}
            </Button>
          </div>
        )
      ) : null}
      {failed ? <p className="mt-2 text-sm text-error">{t("moderationActionFailed")}</p> : null}
    </li>
  );
}
