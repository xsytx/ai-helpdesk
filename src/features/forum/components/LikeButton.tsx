import { cn } from "@/shared/lib/cn";
import { playPopSound, pop } from "@/shared/lib/motion";
import { ChevronUp } from "lucide-react";
import { useRef } from "react";

export function LikeButton({
  likes,
  active,
  disabled,
  onClick,
  label,
}: {
  likes: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  const iconRef = useRef<SVGSVGElement>(null);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        // Celebrate likes only; un-liking stays quiet.
        if (!active) {
          pop(iconRef.current);
          playPopSound();
        }
        onClick();
      }}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-label hover:bg-background-2 hover:text-primary",
        disabled && "opacity-60",
      )}
      aria-pressed={active}
    >
      <ChevronUp ref={iconRef} className={cn("h-4 w-4", active && "fill-primary")} />
      <span className="tabular-nums">{likes}</span>
    </button>
  );
}
