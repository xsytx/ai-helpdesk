import { useAuth } from "@/app/AuthContext";
import {
  loginRequest,
  resendVerificationRequest,
  savePending,
  toUser,
} from "@/features/auth/api";
import { getErrorStatus } from "@/shared/api/client";
import { useLocale } from "@/i18n/LocaleContext";
import { AuthLayout } from "@/shared/layout/AuthLayout";
import { isUniversityEmail } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { PasswordField } from "@/shared/ui/PasswordField";
import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError(undefined);
    setEmailError(undefined);
    setFormError(undefined);

    if (!isUniversityEmail(email)) {
      setEmailError(t("corporateEmail"));
      return;
    }
    if (password.length < 6) {
      setPasswordError(t("invalidCredentials"));
      return;
    }

    setLoading(true);
    try {
      const { token, user } = await loginRequest(email, password);
      if (!user.email_verified) {
        const devCode = await resendVerificationRequest(token).catch(() => undefined);
        savePending({ purpose: "signup", token, user: toUser(user), devCode });
        navigate("/verify");
        return;
      }
      login(toUser(user), token);
      navigate("/");
    } catch (err) {
      const status = getErrorStatus(err);
      if (status === 401) setPasswordError(t("invalidCredentials"));
      else if (status === 403) setFormError(t("accountSuspended"));
      else if (status === 429) setFormError(t("tooManyRequests"));
      else setFormError(t("serverUnavailable"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("login")}</h1>
      {notice ? (
        <p className="mb-4 rounded-xl bg-background-2 px-3 py-2 text-sm text-primary">{notice}</p>
      ) : null}
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Input
          label={t("email")}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
        />
        <PasswordField
          label={t("password")}
          name="password"
          autoComplete="current-password"
          placeholder={t("passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
        />

        {formError ? (
          <p className="text-sm text-error" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-primary-light hover:underline">
            {t("forgotPassword")}
          </Link>
        </div>

        <Button type="submit" size="lg" disabled={loading}>
          {loading ? t("loading") : t("logIn")}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-label">
        {t("noAccount")}{" "}
        <Link to="/signup" className="font-semibold text-primary hover:underline">
          {t("signUp")}
        </Link>
      </p>
    </AuthLayout>
  );
}
