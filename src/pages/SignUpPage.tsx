import { registerRequest, savePending, toUser } from "@/features/auth/api";
import { getErrorMessage, getErrorStatus } from "@/shared/api/client";
import { useAuth } from "@/app/AuthContext";
import { useLocale } from "@/i18n/LocaleContext";
import { AuthLayout } from "@/shared/layout/AuthLayout";
import { isUniversityEmail, isValidUsername } from "@/shared/lib/format";
import { checkPassword, emailName } from "@/shared/lib/password";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { PasswordField } from "@/shared/ui/PasswordField";
import { PasswordHint, passwordProblemMessage } from "@/shared/ui/PasswordHint";
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
    } else if (!isValidUsername(username.trim())) {
      setUsernameError(t("usernameFormat"));
      invalid = true;
    }
    if (!isUniversityEmail(email)) {
      setEmailError(t("corporateEmail"));
      invalid = true;
    }
    const passwordProblem = checkPassword(password, [emailName(email), username]);
    if (passwordProblem) {
      setPasswordError(t(passwordProblemMessage[passwordProblem]));
      invalid = true;
    }
    if (invalid) return;

    setLoading(true);
    try {
      const res = await registerRequest({ email, password, displayName: username.trim() });
      savePending({
        purpose: "signup",
        token: res.token,
        user: toUser(res.user),
        devCode: res.dev_verification_code,
      });
      navigate("/verify");
    } catch (err) {
      const status = getErrorStatus(err);
      if (status === 429) {
        setFormError(t("tooManyRequests"));
      } else if (status === 409) {
        // The backend reports which field collided in its error message.
        if (getErrorMessage(err)?.includes("display name")) setUsernameError(t("usernameTaken"));
        else setEmailError(t("emailAlreadyUsed"));
      } else {
        setFormError(t("signUpFailed"));
      }
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
          maxLength={20}
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
          onChange={(e) => {
            setPassword(e.target.value);
            setPasswordError(undefined);
          }}
          error={passwordError}
        />
        {passwordError ? null : (
          <PasswordHint password={password} personal={[emailName(email), username]} />
        )}
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
