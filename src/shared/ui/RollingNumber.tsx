import { cn } from "@/shared/lib/cn";
import { useState } from "react";

/**
 * A number whose changed digits roll like an odometer: up when the value
 * grows, down when it shrinks. Unchanged digits stay still.
 */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  // Remember the value before the latest change (derived during render).
  const [state, setState] = useState({ value, previous: value });
  if (state.value !== value) setState({ value, previous: state.value });

  const next = String(value);
  const prev = String(state.previous);
  const width = Math.max(next.length, prev.length);
  const nextDigits = next.padStart(width, " ").split("");
  const prevDigits = prev.padStart(width, " ").split("");
  const up = value > state.previous;

  return (
    <span className={cn("inline-flex tabular-nums", className)} aria-label={next}>
      {nextDigits.map((digit, i) => {
        const old = prevDigits[i];
        const changed = digit !== old;
        return (
          <span
            // A new key on change restarts the roll for just this digit.
            key={changed ? `${i}-${value}` : i}
            className="relative inline-block overflow-hidden"
            aria-hidden
          >
            <span
              className={cn(
                "inline-block",
                changed && (up ? "motion-safe:animate-roll-in-up" : "motion-safe:animate-roll-in-down"),
              )}
            >
              {digit.trim()}
            </span>
            {changed && old.trim() ? (
              <span
                className={cn(
                  "absolute inset-0 motion-reduce:hidden",
                  up ? "animate-roll-out-up" : "animate-roll-out-down",
                )}
              >
                {old}
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
