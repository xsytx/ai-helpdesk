import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { CloudOff, RotateCw } from "lucide-react";
import { Button } from "./Button";

/**
 * A list or page that failed to load: says so (never "nothing here yet",
 * which would look like an empty list) and offers Retry. Calm grey, not the
 * error red: usually a passing connection problem, not the student's mistake.
 */
export function LoadError({
  onRetry,
  retrying = false,
  message,
  className,
}: {
  onRetry: () => void;
  retrying?: boolean;
  /** Defaults to "Couldn't load this. Check your connection…". */
  message?: string;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div className={cn("flex flex-col items-center gap-3 py-5 text-center", className)} role="alert">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background-2 text-label" aria-hidden>
        <CloudOff className="h-5 w-5" />
      </span>
      <p className="max-w-xs text-sm text-label">{message ?? t("loadFailed")}</p>
      <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
        <RotateCw className={cn("h-4 w-4", retrying && "animate-spin motion-reduce:animate-none")} aria-hidden />
        {t("retry")}
      </Button>
    </div>
  );
}
