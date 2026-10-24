import { useLocale } from "@/i18n/LocaleContext";
import { useTheme } from "@/shared/lib/theme";
import { Moon, Sun } from "lucide-react";

/** One click between light and dark (Settings also offers "like the system"). */
export function ThemeToggle() {
  const { t } = useLocale();
  const { resolved, setChoice } = useTheme();
  const dark = resolved === "dark";
  const label = t(dark ? "themeSwitchToLight" : "themeSwitchToDark");
  return (
    <button
      type="button"
      onClick={() => setChoice(dark ? "light" : "dark")}
      className="rounded-xl p-2 text-label transition-colors hover:bg-background-2 hover:text-primary"
      aria-label={label}
      title={label}
    >
      {dark ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
    </button>
  );
}
