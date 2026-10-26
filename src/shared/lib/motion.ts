// Small UI animations and sounds. Everything here is decoration: it does
// nothing when the browser can't do it or the user asked for less motion.

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Plays a short animation on an element, unless the user prefers less motion. */
function play(el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  if (!el || typeof el.animate !== "function" || prefersReducedMotion()) return;
  el.animate(keyframes, options);
}

/**
 * Makes an element blink three times, e.g. the answer a notification points
 * at. With less motion asked for, a plain outline shows for a moment instead.
 */
export function flash(el: HTMLElement | null) {
  if (!el) return;
  const color = "var(--color-brand)";
  if (prefersReducedMotion() || typeof el.animate !== "function") {
    el.style.outline = `2px solid ${color}`;
    window.setTimeout(() => (el.style.outline = ""), 2000);
    return;
  }
  const on = { boxShadow: `0 0 0 2px ${color}, inset 0 0 0 999px color-mix(in oklab, ${color} 12%, transparent)` };
  const off = { boxShadow: "0 0 0 2px transparent, inset 0 0 0 999px transparent" };
  el.animate([off, on, off, on, off, on, off], { duration: 1800, easing: "ease-in-out" });
}

/** Quick grow-and-settle, e.g. on a like. */
export function pop(el: Element | null) {
  play(
    el,
    [{ transform: "scale(1)" }, { transform: "scale(1.45)" }, { transform: "scale(1)" }],
    { duration: 320, easing: "cubic-bezier(.3,1.6,.5,1)" },
  );
}

/** Side-to-side "no" shake, e.g. on a wrong code. */
export function shake(el: Element | null) {
  play(
    el,
    [0, -8, 8, -6, 6, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 400, easing: "ease-out" },
  );
}

/**
 * Slides elements from their old position to where they are now (the FLIP
 * technique). Call with each element's `offsetTop` measured before the DOM
 * changed (offsets, not screen positions, so scrolling doesn't count as a move).
 */
export function slideFromPrevious(elements: Map<string, HTMLElement>, previousTops: Map<string, number>) {
  for (const [id, el] of elements) {
    const before = previousTops.get(id);
    if (before === undefined) continue;
    const dy = before - el.offsetTop;
    if (Math.abs(dy) < 1) continue;
    play(el, [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
      duration: 350,
      easing: "cubic-bezier(.2,.8,.2,1)",
    });
  }
}

let audio: AudioContext | null = null;

/** A soft, short "pop", generated on the fly so there's no sound file to load. */
export function playPopSound() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(1100, now + 0.06);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {
    // No Web Audio (old browser, blocked) — stay silent.
  }
}
