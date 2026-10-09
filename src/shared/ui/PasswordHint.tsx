import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/shared/lib/password";
import { Check } from "lucide-react";

export const passwordProblemMessage: Record<
  NonNullable<ReturnType<typeof checkPassword>>,
  TranslationKey
> = {
  tooShort: "passwordRequirements",
  tooCommon: "passwordTooCommon",
  hasPersonalInfo: "passwordHasPersonalInfo",
};

/** Live feedback under a new-password field, updated as the user types. */
export function PasswordHint({ password, personal }: { password: string; personal?: string[] }) {
  const { t } = useLocale();
  if (!password) return null;

  const problem = checkPassword(password, personal);
  let text: string;
  if (problem === "tooShort") {
    text = `${t("passwordMinLength")} (${password.length}/${MIN_PASSWORD_LENGTH})`;
  } else if (problem) {
    text = t(passwordProblemMessage[problem]);
  } else {
    text = t("passwordLooksGood");
  }

  return (
    <p
      className={cn(
        "-mt-2 flex items-center gap-1 text-xs",
        problem === "tooShort" && "text-label",
        problem && problem !== "tooShort" && "text-error",
        !problem && "text-primary",
      )}
      aria-live="polite"
    >
      {!problem ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
      {text}
    </p>
  );
}
