import { cn } from "@/shared/lib/cn";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-surface/60 bg-surface p-5 shadow-sm md:p-6",
        className,
      )}
      {...props}
    />
  );
}
