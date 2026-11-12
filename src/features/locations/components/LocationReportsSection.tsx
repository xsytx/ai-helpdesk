import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Check, ExternalLink, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLocationReports, useSetLocationReportStatus, type LocationReport, type LocationReportStatus } from "../api";
import { ENTRANCE_KEY, parseRoomCode } from "../places";
import { ReportPhoto } from "./PhotoManager";

const TABS: { status: LocationReportStatus; key: TranslationKey }[] = [
  { status: "open", key: "reportsOpen" },
  { status: "fixed", key: "mapReportsFixed" },
  { status: "rejected", key: "mapReportsRejected" },
];

/** The place on the navigation page: rooms by search, other places by their code. */
const mapLink = (code: string) =>
  parseRoomCode(code) ? `/navigation?q=${encodeURIComponent(code)}` : `/navigation?place=${encodeURIComponent(code)}`;

/** Admin panel section: students' "the route is wrong" reports from the Maps page. */
export function LocationReportsSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<LocationReportStatus>("open");
  const { data, isPending, isError } = useLocationReports(status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            type="button"
            role="tab"
            aria-selected={status === tab.status}
            onClick={() => setStatus(tab.status)}
            className={cn(
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              status === tab.status ? "bg-brand text-white" : "bg-surface text-primary hover:bg-background-2",
            )}
          >
            {t(tab.key)}
            {tab.status === status && data ? ` (${data.length})` : ""}
          </button>
        ))}
      </div>
      <p className="text-sm text-label">{t("mapReportsHint")}</p>
      {isPending ? <p className="text-sm text-label">{t("loading")}</p> : null}
      {isError ? <p className="text-sm text-error">{t("insightsLoadFailed")}</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-label">{t("moderationEmpty")}</p> : null}
      <ul className="space-y-2">
        {data?.map((r) => <MapReportCard key={r.id} report={r} />)}
      </ul>
    </div>
  );
}

function MapReportCard({ report }: { report: LocationReport }) {
  const { t, locale } = useLocale();
  const setStatus = useSetLocationReportStatus();
  const busy = setStatus.isPending;
  const act = (status: LocationReportStatus) => setStatus.mutate({ id: report.id, status });

  return (
    <li className="rounded-2xl border border-surface/60 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        <span className="rounded-full bg-background-2 px-2 py-0.5 text-primary">{report.placeName || report.placeCode}</span>
        <span className="rounded-full bg-background-2 px-2 py-0.5 font-mono text-label">{report.placeCode}</span>
        {report.entrance ? (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">
            {t(ENTRANCE_KEY[report.entrance])}
          </span>
        ) : null}
        <span className="font-normal text-label">
          {report.reporterName} · {formatRelativeTime(report.createdAt, locale)}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-primary">{report.text}</p>
      <ReportPhoto report={report} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to={mapLink(report.placeCode)} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            {t("mapReportsOpenMap")}
          </Link>
        </Button>
        {report.status === "open" ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => act("fixed")}>
              <Check className="h-4 w-4" />
              {t("mapReportsMarkFixed")}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act("rejected")}>
              <X className="h-4 w-4" />
              {t("mapReportsReject")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => act("open")}>
            <RotateCcw className="h-4 w-4" />
            {t("mapReportsReopen")}
          </Button>
        )}
      </div>
      {setStatus.isError ? <p className="mt-2 text-sm text-error">{t("moderationActionFailed")}</p> : null}
    </li>
  );
}
