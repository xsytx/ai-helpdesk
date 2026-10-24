import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
}

export function PasswordField({
  label,
  error,
  id = "password",
  className,
  ...props
}: PasswordFieldProps) {
  const { t } = useLocale();
  const [show, setShow] = useState(false);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          className={cn(
            "flex h-11 w-full rounded-xl border bg-surface py-2 pl-3.5 pr-11 text-sm text-primary placeholder:text-grey",
            "border-border focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
            error && "border-error focus-visible:ring-error/20",
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          {...props}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-label hover:bg-background-2"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? t("hidePassword") : t("showPassword")}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
