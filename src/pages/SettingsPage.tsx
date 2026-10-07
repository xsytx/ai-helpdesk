import { useAuth } from "@/app/AuthContext";
import { AvatarPicker } from "@/features/profile/components/AvatarPicker";
import { PasswordChangeForm } from "@/features/profile/components/PasswordChangeForm";
import { useLocale } from "@/i18n/LocaleContext";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { LanguageSwitcher } from "@/shared/layout/LanguageSwitcher";
import { Navigate } from "react-router-dom";

export function SettingsPage() {
  const { user, logout } = useAuth();
  const { t } = useLocale();

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
      </Card>
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
