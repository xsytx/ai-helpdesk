import { resetPasswordRequest } from "@/features/auth/api";
import { useAuth } from "@/app/AuthContext";
import { useLocale } from "@/i18n/LocaleContext";
import { getErrorStatus } from "@/shared/api/client";
import { AuthLayout } from "@/shared/layout/AuthLayout";
import { checkPassword, emailName } from "@/shared/lib/password";
import { Button } from "@/shared/ui/Button";
import { PasswordField } from "@/shared/ui/PasswordField";
import { PasswordHint, passwordProblemMessage } from "@/shared/ui/PasswordHint";
import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

/** Last step of "Forgot password?" — reached from the code screen with { email, code }. */
export function ResetPasswordPage() {
  const { isAuthenticated } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const state = useLocation().state as { email?: string; code?: string } | null;
  const email = state?.email;
  const code = state?.code;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [confirmError, setConfirmError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!email || !code) {
    return <Navigate to="/forgot-password" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !code) return;
    setPasswordError(undefined);
    setConfirmError(undefined);
    setFormError(undefined);
    const passwordProblem = checkPassword(password, [emailName(email)]);
    if (passwordProblem) {
      setPasswordError(t(passwordProblemMessage[passwordProblem]));
      return;
    }
    if (password !== confirm) {
      setConfirmError(t("passwordsDoNotMatch"));
      return;
    }
    setLoading(true);
    try {
      await resetPasswordRequest(email, code, password);
      navigate("/login", { state: { notice: t("passwordUpdated") } });
    } catch (err) {
      setFormError(getErrorStatus(err) === 400 ? t("resetCodeInvalid") : t("serverUnavailable"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="mb-2 text-2xl font-bold text-primary">{t("resetPasswordTitle")}</h1>
      <p className="mb-6 text-sm text-label">{t("resetPasswordSubtitle")}</p>
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <PasswordField
          id="new-password"
          label={t("newPassword")}
          name="new-password"
          autoComplete="new-password"
          placeholder={t("passwordPlaceholder")}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setPasswordError(undefined);
          }}
          error={passwordError}
        />
        {passwordError ? null : <PasswordHint password={password} personal={[emailName(email)]} />}
        <PasswordField
          id="confirm-password"
          label={t("confirmPassword")}
          name="confirm-password"
          autoComplete="new-password"
          placeholder={t("confirmPasswordPlaceholder")}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={confirmError}
        />
        {formError ? (
          <p className="text-sm text-error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? t("loading") : t("savePassword")}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm">
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {t("backToLogin")}
        </Link>
      </p>
    </AuthLayout>
  );
}
