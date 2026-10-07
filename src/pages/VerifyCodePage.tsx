import { useAuth } from "@/app/AuthContext";
import {
  clearPending,
  forgotPasswordRequest,
  readPending,
  resendVerificationRequest,
  savePending,
  verifyEmailRequest,
  verifyResetCodeRequest,
} from "@/features/auth/api";
import { useLocale } from "@/i18n/LocaleContext";
import { getErrorStatus } from "@/shared/api/client";
import { AuthLayout } from "@/shared/layout/AuthLayout";
import { Button } from "@/shared/ui/Button";
import { OtpInput } from "@/shared/ui/OtpInput";
import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

/** Enter the emailed 6-digit code — after sign up, or after "Forgot password?". */
export function VerifyCodePage() {
  const { isAuthenticated, login } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [pending, setPending] = useState(readPending);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!pending) {
    return <Navigate to="/login" replace />;
  }

  const email = pending.purpose === "signup" ? pending.user.email : pending.email;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError(undefined);
    if (code.length !== 6) {
      setError(t("codeIncomplete"));
      return;
    }
    setLoading(true);
    try {
      if (pending.purpose === "signup") {
        await verifyEmailRequest(pending.token, code);
        clearPending();
        login({ ...pending.user, emailVerified: true }, pending.token);
        navigate("/");
      } else {
        // Checked here so a wrong code is caught before the new-password step;
        // the code is only used up by /reset-password itself.
        await verifyResetCodeRequest(pending.email, code);
        clearPending();
        navigate("/reset-password", { state: { email: pending.email, code } });
      }
    } catch (err) {
      const status = getErrorStatus(err);
      setError(
        status === 400 ? t("wrongCode") : status === 429 ? t("tooManyRequests") : t("serverUnavailable"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!pending) return;
    setResending(true);
    setError(undefined);
    try {
      const devCode =
        pending.purpose === "signup"
          ? await resendVerificationRequest(pending.token)
          : await forgotPasswordRequest(pending.email);
      const next = { ...pending, devCode };
      savePending(next);
      setPending(next);
      setCode("");
    } catch (err) {
      setError(getErrorStatus(err) === 429 ? t("tooManyRequests") : t("serverUnavailable"));
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="mb-2 text-2xl font-bold text-primary">{t("checkEmailTitle")}</h1>
      <p className="mb-6 text-sm text-label">
        {t("checkEmailSubtitle")} <span className="font-medium text-primary">{email}</span>
      </p>
      <form className="space-y-5" onSubmit={handleSubmit}>
        <OtpInput value={code} onChange={setCode} error={Boolean(error)} />
        {error ? (
          <p className="text-center text-xs text-error" role="alert">
            {error}
          </p>
        ) : null}
        {pending.devCode ? (
          <p className="rounded-xl bg-background-2 px-3 py-2 text-center text-xs text-label">
            {t("demoCodeHint")}: <span className="font-semibold text-primary">{pending.devCode}</span>
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? t("loading") : t("verify")}
        </Button>
      </form>
      <div className="mt-5 flex flex-col items-center gap-2 text-sm">
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          className="font-medium text-primary-light hover:underline disabled:opacity-60"
        >
          {resending ? t("loading") : t("resendCode")}
        </button>
        <Link to="/login" className="text-label hover:underline" onClick={clearPending}>
          {t("backToLogin")}
        </Link>
      </div>
    </AuthLayout>
  );
}
