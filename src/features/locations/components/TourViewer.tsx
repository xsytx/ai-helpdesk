import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TourView } from "../tours";

/**
 * The official 3D tour inside the page (an iframe over everything), so a
 * student never leaves the map. Several views of a place are tabs on top;
 * "new tab" opens the tour on its own site.
 */
export function TourViewer({ title, views, start, onClose }: { title: string; views: TourView[]; start: number; onClose: () => void }) {
  const { t, locale } = useLocale();
  const [i, setI] = useState(start);
  const view = views[i] ?? views[0]!;

  useEffect(() => {
    // Esc closes (captured first: the map would also take it). Inside the
    // tour itself the keys belong to the tour; the × button always works.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // On <body>: the page area is its own layer (page transitions) and would trap it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={t("mapsOpenTour")}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-white">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
          {views.length > 1 ? <span className="font-normal text-white/70"> · {view.label[locale]}</span> : null}
        </p>
        <a
          href={view.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/10"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("mapsTourNewTab")}</span>
        </a>
        <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-lg p-1.5 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      {views.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
          {views.map((v, k) => (
            <button
              key={v.url}
              type="button"
              aria-pressed={k === i}
              onClick={() => setI(k)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                k === i ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20",
              )}
            >
              {v.label[locale]}
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          {t("mapsTourLoading")}
        </p>
        {/* key: another view loads afresh (only the address's #media part changes). */}
        <iframe
          key={view.url}
          src={view.url}
          title={`${title} · ${view.label[locale]}`}
          allow="fullscreen; accelerometer; gyroscope; xr-spatial-tracking"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    </div>,
    document.body,
  );
}
