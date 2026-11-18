// Loading placeholders: grey shapes where the content will be, and Barys
// thinking above them, so a slow page looks busy, not broken. The pulse
// respects "reduce motion" (motion-safe).
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Mascot } from "@/shared/ui/Mascot";

/** One grey bar or block. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("rounded-lg bg-background-2 motion-safe:animate-pulse", className)} aria-hidden />;
}

/** Cards shaped like a list of posts (title, two lines of text, a meta line). */
export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2.5 rounded-2xl border border-border/60 bg-surface p-4">
          <SkeletonBlock className="h-4 w-2/3" />
          <SkeletonBlock className="h-3 w-full" />
          <SkeletonBlock className="h-3 w-5/6" />
          <SkeletonBlock className="h-3 w-1/4" />
        </div>
      ))}
    </div>
  );
}

/** A whole page loading: Barys with "Loading…", a title bar and a few cards. */
export function PageSkeleton({ rows = 3, title = true, className }: { rows?: number; title?: boolean; className?: string }) {
  const { t } = useLocale();
  return (
    <div className={cn("space-y-4", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Mascot mood="think" size="sm" />
        <p className="text-sm font-semibold text-label">{t("loading")}</p>
      </div>
      {title ? <SkeletonBlock className="h-7 w-1/2 max-w-xs" /> : null}
      <SkeletonList rows={rows} />
    </div>
  );
}
