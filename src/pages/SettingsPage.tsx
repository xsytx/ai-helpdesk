import { useAuth } from "@/app/AuthContext";
import { AvatarPicker } from "@/features/profile/components/AvatarPicker";
import { PasswordChangeForm } from "@/features/profile/components/PasswordChangeForm";
import { MyReputationCard } from "@/features/reputation/components/MyReputationCard";
import { useLocale } from "@/i18n/LocaleContext";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { LanguageSwitcher } from "@/shared/layout/LanguageSwitcher";
import { requestTour } from "@/features/onboarding/tour";
import { isStaffRole } from "@/features/moderation/api";
import { useTheme, type ThemeChoice } from "@/shared/lib/theme";
import { cn } from "@/shared/lib/cn";
import { Compass, Monitor, Moon, ShieldCheck, Sun } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";

const THEMES: { value: ThemeChoice; icon: typeof Sun; label: "themeSystem" | "themeLight" | "themeDark" }[] = [
  { value: "system", icon: Monitor, label: "themeSystem" },
  { value: "light", icon: Sun, label: "themeLight" },
  { value: "dark", icon: Moon, label: "themeDark" },
];

/** Light / dark / like the system. */
function ThemePicker() {
  const { t } = useLocale();
  const [theme, setTheme] = useTheme();
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <span id="theme-label" className="text-sm font-medium text-label">
        {t("themeLabel")}
      </span>
      <div role="radiogroup" aria-labelledby="theme-label" className="inline-flex rounded-xl bg-background-2 p-1">
        {THEMES.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
              theme === value ? "bg-surface text-primary shadow-sm" : "text-label hover:text-primary",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <h1 className="text-xl font-bold text-primary">{t("settings")}</h1>
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-label">{t("emailLabel")}</dt>
            <dd className="break-all font-medium text-primary">{user.email}</dd>
          </div>
          <div>
            <dt className="text-label">{t("roleLabel")}</dt>
            <dd className="font-medium capitalize text-primary">{user.role}</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-medium text-label">{t("languageLabel")}</span>
          <LanguageSwitcher />
        </div>
        <ThemePicker />
        <Button
          variant="secondary"
          size="sm"
          className="mt-4 w-full"
          onClick={() => {
            requestTour();
            navigate("/", { viewTransition: true });
          }}
        >
          <Compass className="h-4 w-4" />
          {t("replayTour")}
        </Button>
        {isStaffRole(user.role) ? (
          <Button asChild variant="secondary" size="sm" className="mt-2 w-full">
            <Link viewTransition to="/admin">
              <ShieldCheck className="h-4 w-4" />
              {t("adminPanel")}
            </Link>
          </Button>
        ) : null}
      </Card>
      <MyReputationCard />
      <Card>
        <AvatarPicker />
      </Card>
      <Card>
        <PasswordChangeForm />
      </Card>
      <Button variant="secondary" className="w-full" onClick={logout}>
        {t("logOut")}
      </Button>
    </div>
  );
}
