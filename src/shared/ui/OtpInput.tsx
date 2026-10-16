import { cn } from "@/shared/lib/cn";
import { shake } from "@/shared/lib/motion";
import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

const LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  error,
  shakeKey = 0,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: boolean;
  /** Bump this number to shake the boxes, e.g. after each wrong code. */
  shakeKey?: number;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shakeKey > 0) shake(groupRef.current);
  }, [shakeKey]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  function setDigit(index: number, char: string) {
    const next = digits.slice();
    next[index] = char;
    onChange(next.join("").slice(0, LENGTH));
  }

  function handleChange(index: number, raw: string) {
    const char = raw.replace(/\D/g, "").slice(-1);
    if (!char) {
      setDigit(index, "");
      return;
    }
    setDigit(index, char);
    refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      e.preventDefault();
      setDigit(index - 1, "");
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < LENGTH - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  }

  return (
    <div ref={groupRef} className="flex justify-center gap-2" role="group" aria-label="Verification code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          aria-invalid={error}
          className={cn(
            "h-12 w-10 rounded-lg border bg-white text-center text-lg font-semibold text-primary sm:h-14 sm:w-11",
            "border-border focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
            error && "border-error",
          )}
        />
      ))}
    </div>
  );
}
