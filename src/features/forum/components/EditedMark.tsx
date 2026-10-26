import { useLocale } from "@/i18n/LocaleContext";
import { apiClient } from "@/shared/api/client";
import { formatRelativeTime } from "@/shared/lib/format";
import { RichText } from "@/shared/ui/RichText";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Revision {
  title?: string;
  body: string;
  replaced_at: string;
}

/**
 * "· edited" next to a post's time (the exact time on hover). For the
 * author and staff it opens the earlier versions; others only see that it
 * was edited (an edit may have removed something on purpose).
 */
export function EditedMark({
  kind,
  id,
  editedAt,
  canSeeHistory,
}: {
  kind: "thread" | "comment";
  id: string;
  editedAt?: string;
  canSeeHistory: boolean;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  if (!editedAt) return null;
  const when = new Date(editedAt).toLocaleString(locale === "kz" ? "kk" : locale);
  const label = `${t("postEdited")} ${formatRelativeTime(editedAt, locale)}`;
  return (
    <>
      {" · "}
      {canSeeHistory ? (
        <button type="button" onClick={() => setOpen(true)} title={when} className="underline-offset-2 hover:underline">
          {label}
        </button>
      ) : (
        <span title={when}>{label}</span>
      )}
      {open ? <HistoryDialog kind={kind} id={id} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function HistoryDialog({ kind, id, onClose }: { kind: "thread" | "comment"; id: string; onClose: () => void }) {
  const { t, locale } = useLocale();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["forum", "revisions", kind, id],
    queryFn: async () => {
      const { data } = await apiClient.get<{ revisions: Revision[] }>(`/${kind === "thread" ? "threads" : "comments"}/${id}/revisions`);
      return data.revisions;
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // On <body>: the page area is its own layer (page transitions) and would trap it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand/30 p-4 dark:bg-black/60 sm:items-center">
      <div className="absolute inset-0" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-2xl bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="history-title" className="text-lg font-bold text-primary">
            {t("postHistoryTitle")}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-label hover:bg-background-2" aria-label={t("close")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-xs text-label">{t("postHistoryHint")}</p>
        <div className="min-h-0 space-y-3 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-label">{t("loading")}</p>
          ) : isError ? (
            <p className="text-sm text-error">{t("postHistoryFailed")}</p>
          ) : (data ?? []).length === 0 ? (
            <p className="text-sm text-label">{t("postHistoryEmpty")}</p>
          ) : (
            data!.map((r, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-background-2/40 p-3">
                <p className="mb-1 text-xs text-label">
                  {t("postHistoryUntil").replace("{time}", new Date(r.replaced_at).toLocaleString(locale === "kz" ? "kk" : locale))}
                </p>
                {r.title ? <p className="mb-1 text-sm font-semibold text-primary">{r.title}</p> : null}
                <RichText text={r.body} className="text-sm text-primary/90" />
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
