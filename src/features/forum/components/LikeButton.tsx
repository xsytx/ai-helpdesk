import { cn } from "@/shared/lib/cn";
import { playPopSound, pop } from "@/shared/lib/motion";
import { RollingNumber } from "@/shared/ui/RollingNumber";
import { ChevronUp } from "lucide-react";
import { useRef } from "react";

export function LikeButton({
  likes,
  active,
  disabled,
  busy,
  onClick,
  label,
}: {
  likes: number;
  active: boolean;
  disabled?: boolean;
  /** The last click is still saving: ignore clicks, without dimming the button. */
  busy?: boolean;
  onClick: () => void;
  label: string;
}) {
  const iconRef = useRef<SVGSVGElement>(null);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (busy) return;
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
        // Liked is a solid pill so it never looks like the plain hover state.
        active
          ? "bg-primary text-white hover:bg-primary-light"
          : "text-label hover:bg-background-2 hover:text-primary",
        disabled && "opacity-60",
      )}
      aria-pressed={active}
    >
      <ChevronUp ref={iconRef} className={cn("h-4 w-4", active && "fill-white")} />
      <RollingNumber value={likes} />
    </button>
  );
}
