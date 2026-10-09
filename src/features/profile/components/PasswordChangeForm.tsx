import { useLocale } from "@/i18n/LocaleContext";
import { useAuth } from "@/app/AuthContext";
import { checkPassword, emailName } from "@/shared/lib/password";
import { Button } from "@/shared/ui/Button";
import { PasswordField } from "@/shared/ui/PasswordField";
import { PasswordHint, passwordProblemMessage } from "@/shared/ui/PasswordHint";
import { useState, type FormEvent } from "react";
import { usePasswordChange, WRONG_CURRENT_PASSWORD } from "../api";

export function PasswordChangeForm() {
  const { t } = useLocale();
  const { user } = useAuth();
  const personal = [emailName(user?.email), user?.name ?? ""];
  const changePassword = usePasswordChange();

  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentError, setCurrentError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [confirmError, setConfirmError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [success, setSuccess] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setCurrentError(undefined);
    setPasswordError(undefined);
    setConfirmError(undefined);
    setFormError(undefined);
    setSuccess(false);

    let invalid = false;
    if (!current) {
      setCurrentError(t("currentPasswordRequired"));
      invalid = true;
    }
    const passwordProblem = checkPassword(password, personal);
    if (passwordProblem) {
      setPasswordError(t(passwordProblemMessage[passwordProblem]));
      invalid = true;
    } else if (password !== confirm) {
      setConfirmError(t("passwordsDoNotMatch"));
      invalid = true;
    }
    if (invalid) return;

    changePassword.mutate(
      { currentPassword: current, newPassword: password },
      {
        onSuccess: () => {
          setCurrent("");
          setPassword("");
          setConfirm("");
          setSuccess(true);
        },
        onError: (err) => {
          if (err.message === WRONG_CURRENT_PASSWORD) setCurrentError(t("currentPasswordWrong"));
          else setFormError(t("passwordChangeFailed"));
        },
      },
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <h2 className="text-lg font-bold text-primary">{t("changePassword")}</h2>
      <PasswordField
        id="current-password"
        label={t("currentPassword")}
        name="current-password"
        autoComplete="current-password"
        placeholder={t("passwordPlaceholder")}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={currentError}
      />
      <PasswordField
        id="new-password"
        label={t("newPassword")}
        name="new-password"
        autoComplete="new-password"
        placeholder={t("newPasswordPlaceholder")}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setPasswordError(undefined);
        }}
        error={passwordError}
      />
      {passwordError ? null : <PasswordHint password={password} personal={personal} />}
      <PasswordField
        id="confirm-password"
        label={t("confirmNewPassword")}
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
      {success ? (
        <p className="rounded-xl bg-background-2 px-3 py-2 text-sm text-primary" role="status">
          {t("passwordChanged")}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={changePassword.isPending}>
        {changePassword.isPending ? t("loading") : t("savePassword")}
      </Button>
    </form>
  );
}
