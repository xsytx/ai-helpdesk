import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Link } from "react-router-dom";

type LogoProps = {
  className?: string;
  showText?: boolean;
  to?: string;
};

export function Logo({ className, showText = true, to = "/" }: LogoProps) {
  const { t } = useLocale();
  return (
    <Link
      viewTransition
      to={to}
      className={cn("flex items-center gap-2.5 whitespace-nowrap", className)}
    >
      <img
        src="/logo-icon.webp"
        alt=""
        width={36}
        height={36}
        // Navy on a dark page would vanish: a light tile behind it in the dark theme.
        className="h-9 w-9 shrink-0 rounded-sm object-contain dark:rounded-lg dark:bg-white/90 dark:p-0.5"
        decoding="async"
      />
      {showText ? (
        <span className="text-lg font-semibold text-primary">{t("brand")}</span>
      ) : null}
    </Link>
  );
}
