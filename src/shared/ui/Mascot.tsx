import { cn } from "@/shared/lib/cn";
import { useEffect, useState } from "react";

/** Barys, the pixel-art snow leopard: one animation per mood. */
export type MascotMood =
  | "idle" | "hello" | "think" | "sleep" | "happy" | "sad"
  | "confused" | "point-left" | "point-right";

/**
 * public/mascot/barys-<mood>.png: the animation's frames side by side on a
 * transparent background (made from the designer's GIFs: white background
 * removed, empty margins cropped). w × h is one frame; durations in ms, as in
 * the GIF.
 */
const SHEETS: Record<MascotMood, { w: number; h: number; durations: number[] }> = {
  idle: { w: 184, h: 144, durations: [600, 300, 300, 750, 450, 750, 150, 150, 750, 300, 300, 300, 300, 150, 750, 300, 600] },
  hello: { w: 192, h: 174, durations: [150, 150, 150, 150, 150, 300, 150, 150, 150, 300] },
  think: { w: 184, h: 184, durations: Array(12).fill(150) },
  sleep: { w: 184, h: 184, durations: [600, 600, 600, 600, 1200, 600, 300, 300, 600, 600, 1200] },
  happy: { w: 210, h: 192, durations: Array(12).fill(150) },
  sad: { w: 174, h: 144, durations: [300, 300, 300, 300, 900, 300, 300, 300, 300, 300] },
  confused: { w: 204, h: 192, durations: [600, 600, 300, 300, 600, 600, 300, 300] },
  "point-left": { w: 222, h: 144, durations: [450, 450, 450, 450, 450, 150, 150, 150, 450, 450] },
  "point-right": { w: 222, h: 144, durations: [450, 450, 450, 450, 450, 150, 150, 150, 450, 450] },
};
/** The cat's own height in a frame without extras (sparkles, "z"): sizes are set by it. */
const CAT_HEIGHT = 144;

/**
 * The same size everywhere for the same kind of place:
 * sm = next to a line of text (chat, notices), md = a centred empty state,
 * lg = a whole-page message (error, not found).
 */
const SIZES = { sm: 40, md: 56, lg: 80 } as const;
export type MascotSize = keyof typeof SIZES;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The mascot, its cat about SIZES[size] px tall (moods with sparkles or "z" are a little
 * bigger, so the cat itself is the same size in every mood). With "reduce
 * motion" on, it stays on the first frame. Decorative: the text next to it
 * says the same, so screen readers skip it.
 */
/** One frame's size in px and the whole sheet's background size for a mood at a size. */
function geometry(mood: MascotMood, size: MascotSize) {
  const sheet = SHEETS[mood];
  const scale = SIZES[size] / CAT_HEIGHT;
  const w = Math.round(sheet.w * scale);
  const h = Math.round(sheet.h * scale);
  return { sheet, w, h, backgroundSize: `${w * sheet.durations.length}px ${h}px` };
}

/**
 * The mascot as a plain element, for places outside React (the onboarding
 * tour's tips). It animates itself and stops once it is taken off the page.
 */
export function mascotElement(mood: MascotMood, size: MascotSize = "md"): HTMLElement {
  const { sheet, w, h, backgroundSize } = geometry(mood, size);
  const el = document.createElement("span");
  el.setAttribute("aria-hidden", "true");
  el.className = "sdu-mascot";
  Object.assign(el.style, {
    display: "block",
    width: `${w}px`,
    height: `${h}px`,
    backgroundImage: `url(/mascot/barys-${mood}.png)`,
    backgroundRepeat: "no-repeat",
    backgroundSize,
    backgroundPosition: "0 0",
  });
  if (reducedMotion()) return el;
  let i = 0;
  const next = () =>
    setTimeout(() => {
      // Wait while it is still being put on the page; stop once it is removed.
      if (!el.isConnected && i > 0) return;
      i = (i + 1) % sheet.durations.length;
      el.style.backgroundPosition = `${-i * w}px 0`;
      next();
    }, sheet.durations[i]);
  next();
  return el;
}

export function Mascot({ mood, size = "md", className }: { mood: MascotMood; size?: MascotSize; className?: string }) {
  const { sheet, w, h, backgroundSize } = geometry(mood, size);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (reducedMotion()) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        i = (i + 1) % sheet.durations.length;
        setFrame(i);
        next();
      }, sheet.durations[i]);
    };
    next();
    return () => clearTimeout(timer);
  }, [sheet]);

  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 bg-no-repeat",
        // The navy outline nearly matches the dark page: a faint light edge keeps the shape.
        "dark:[filter:drop-shadow(0_0_1px_rgb(255_255_255/0.6))]",
        className,
      )}
      style={{
        width: w,
        height: h,
        backgroundImage: `url(/mascot/barys-${mood}.png)`,
        backgroundSize,
        backgroundPosition: `${-frame * w}px 0`,
      }}
    />
  );
}
