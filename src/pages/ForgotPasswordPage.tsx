import { useAuth } from "@/app/AuthContext";
import { forgotPasswordRequest, savePending } from "@/features/auth/api";
import { useLocale } from "@/i18n/LocaleContext";
import { getErrorStatus } from "@/shared/api/client";
import { AuthLayout } from "@/shared/layout/AuthLayout";
import { isUniversityEmail } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

export function ForgotPasswordPage() {
  const { isAuthenticated } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setEmailError(undefined);
    setFormError(undefined);
    if (!isUniversityEmail(email)) {
      setEmailError(t("invalidEmail"));
      return;
    }

    setLoading(true);
    try {
      // The backend answers the same way whether or not the account exists,
      // so it can't be used to discover registered emails.
      const normalized = email.trim().toLowerCase();
      const devCode = await forgotPasswordRequest(normalized);
      savePending({ purpose: "reset", email: normalized, devCode });
      navigate("/verify");
    } catch (err) {
      setFormError(getErrorStatus(err) === 429 ? t("tooManyRequests") : t("serverUnavailable"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="mb-2 text-2xl font-bold text-primary">{t("forgotPassword")}</h1>
      <p className="mb-6 text-sm text-label">{t("forgotPasswordSubtitle")}</p>
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
        {formError ? (
          <p className="text-sm text-error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? t("loading") : t("sendCode")}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-label">
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {t("backToLogin")}
        </Link>
      </p>
    </AuthLayout>
  );
}
