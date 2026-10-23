import { memo, useEffect, useRef, useState } from "react";

// The model sends text in uneven bursts (2 letters, then 20 at once, then a
// pause). Shown as it arrives, that jerks. This bubble types it out instead:
// every screen frame it reveals a share of what is still hidden, so the text
// runs at the model's own pace, slightly behind it, without jumps and
// without stopping between bursts.
const LAG_MS = 350; // how far, roughly, the typing trails the model

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The answer being written. text is everything received so far; onGrow runs
 * after each frame that added letters (to keep the chat scrolled down).
 */
export const StreamingBubble = memo(function StreamingBubble({ text, onGrow }: { text: string; onGrow: () => void }) {
  const [shown, setShown] = useState(0);
  const textRef = useRef(text);
  textRef.current = text;
  const onGrowRef = useRef(onGrow);
  onGrowRef.current = onGrow;

  // A reset (the model starts again) makes the text shorter: start over.
  if (shown > text.length) setShown(text.length);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let frame = 0;
    let last = performance.now();
    let position = 0; // fractional, so slow typing still moves every few frames
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const target = textRef.current.length;
      if (position > target) position = target;
      if (position < target) {
        // Close a share of the gap each frame: big bursts speed it up, and the
        // tail keeps it moving while the next piece is on its way.
        position += Math.max((target - position) * (1 - Math.exp(-dt / LAG_MS)), dt / 150);
        position = Math.min(position, target);
        const next = Math.floor(position);
        setShown((current) => (current === next ? current : next));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const visible = prefersReducedMotion() ? text : text.slice(0, shown);
  useEffect(() => {
    onGrowRef.current();
  }, [visible.length]);

  return (
    <div className="mr-auto max-w-[90%] rounded-2xl rounded-bl-md bg-background-2 px-4 py-2.5 text-sm text-primary">
      <p className="whitespace-pre-wrap">
        {visible}
        <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-primary/60 motion-safe:animate-pulse" aria-hidden />
      </p>
    </div>
  );
});
