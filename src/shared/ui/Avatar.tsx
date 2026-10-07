import { getInitials } from "@/shared/lib/format";
import { cn } from "@/shared/lib/cn";

interface AvatarProps {
  name: string;
  /** Image URL; falls back to initials when absent. */
  src?: string;
  className?: string;
}

export function Avatar({ name, src, className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn("h-9 w-9 shrink-0 rounded-full bg-background-2 object-cover", className)}
        aria-hidden
      />
    );
  }
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white",
        className,
      )}
      aria-hidden
    >
      {getInitials(name)}
    </div>
  );
}
