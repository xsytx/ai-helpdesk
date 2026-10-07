import { accountExists, delay, startVerification } from "@/features/auth/demoAuth";
import { useAuth } from "@/app/AuthContext";
import { useLocale } from "@/i18n/LocaleContext";
import { AuthLayout } from "@/shared/layout/AuthLayout";
import { isStrongPassword, isUniversityEmail } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { PasswordField } from "@/shared/ui/PasswordField";
import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

export function SignUpPage() {
  const { isAuthenticated } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usernameError, setUsernameError] = useState<string>();
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setUsernameError(undefined);
    setEmailError(undefined);
    setPasswordError(undefined);
    setFormError(undefined);

    let invalid = false;
    if (!username.trim()) {
      setUsernameError(t("createUsername"));
      invalid = true;
    }
    if (!isUniversityEmail(email)) {
      setEmailError(t("corporateEmail"));
      invalid = true;
    } else if (accountExists(email)) {
      setEmailError(t("emailAlreadyUsed"));
      invalid = true;
    }
    if (!isStrongPassword(password)) {
      setPasswordError(t("passwordRequirements"));
      invalid = true;
    }
    if (invalid) return;

    setLoading(true);
    try {
      await delay();
      startVerification({
        email,
        purpose: "signup",
        username: username.trim(),
        password,
      });
      navigate("/verify", { state: { email: email.trim().toLowerCase(), purpose: "signup" } });
    } catch {
      setFormError(t("signUpFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="mb-6 text-2xl font-bold text-primary">{t("signUpTitle")}</h1>
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Input
          label={t("username")}
          name="username"
          autoComplete="username"
          placeholder={t("usernamePlaceholder")}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={usernameError}
        />
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
          autoComplete="new-password"
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
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? t("loading") : t("signUp")}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-label">
        {t("alreadyHaveAccount")}{" "}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {t("logIn")}
        </Link>
      </p>
    </AuthLayout>
  );
}
