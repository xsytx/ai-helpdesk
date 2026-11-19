// A course's profile as a hexagon (radar chart): six 1–5 scores about the
// course itself (not its instructor), arranged so a bigger shape is always
// better: useful, interesting, practical, beginner-friendly, easy, light
// workload. Difficulty and workload are stored as "5 = hard / heavy" and are
// flipped here. One series, in the brand colour; the grid rings are 1–5.
// Each corner has a tooltip, the big one labels every axis with its value,
// and a hidden list carries the same numbers for screen readers.
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";

/** The scores a review or a course's averages carry (0 = not given). */
export interface ReviewScores {
  difficulty: number;
  workload: number;
  usefulness: number;
  interest: number;
  practical: number;
  beginner: number;
}

/** The six axes, clockwise from the top; `value` turns the stored scores into "bigger is better". */
export const HEX_AXES: { key: TranslationKey; value: (s: ReviewScores) => number }[] = [
  { key: "hexUseful", value: (s) => s.usefulness },
  { key: "hexInteresting", value: (s) => s.interest },
  { key: "hexPractical", value: (s) => s.practical },
  { key: "hexLight", value: (s) => (s.workload ? 6 - s.workload : 0) },
  { key: "hexEasy", value: (s) => (s.difficulty ? 6 - s.difficulty : 0) },
  { key: "hexBeginner", value: (s) => s.beginner },
];

const point = (cx: number, cy: number, r: number, i: number) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};
const ring = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => point(cx, cy, r, i).join(",")).join(" ");

export function ReviewHexagon({ scores, size = "lg", className }: {
  scores: ReviewScores;
  /** lg: axis names and values around it; sm: a small shape (a review in the list). */
  size?: "lg" | "sm";
  className?: string;
}) {
  const { t } = useLocale();
  const lg = size === "lg";
  // The big one leaves room for the axis names around it.
  // Side labels get ~110 px each: the longest ("Мало нагрузки", "For beginners") fit.
  const [w, h] = lg ? [420, 290] : [64, 64];
  const [cx, cy] = [w / 2, h / 2];
  const R = lg ? 92 : 28;
  const values = HEX_AXES.map((a) => Math.max(0, Math.min(5, a.value(scores))));
  const shape = values.map((v, i) => point(cx, cy, (R * v) / 5, i).join(",")).join(" ");
  const fmt = (v: number) => (v > 0 ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : "–");
  const summary = HEX_AXES.map((a, i) => `${t(a.key)}: ${fmt(values[i]!)}/5`).join(", ");

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={cn("block", lg ? "h-auto w-full max-w-[420px]" : "h-16 w-16")}
        role="img"
        aria-label={`${t("reviewsHexTitle")}: ${summary}`}
      >
        {/* Grid: rings at 1–5 and the six spokes, recessive. */}
        <g fill="none" stroke="var(--color-border)" strokeWidth={lg ? 1 : 0.75}>
          {[1, 2, 3, 4, 5].map((n) => (
            <polygon key={n} points={ring(cx, cy, (R * n) / 5)} strokeOpacity={n === 5 ? 1 : 0.7} />
          ))}
          {lg ? values.map((_, i) => <line key={i} x1={cx} y1={cy} x2={point(cx, cy, R, i)[0]} y2={point(cx, cy, R, i)[1]} strokeOpacity={0.7} />) : null}
        </g>

        {/* The course's shape. */}
        <polygon points={shape} fill="var(--color-brand)" fillOpacity={0.18} stroke="var(--color-brand)" strokeWidth={lg ? 2 : 1.5} strokeLinejoin="round" />

        {lg
          ? values.map((v, i) => {
              const [x, y] = point(cx, cy, (R * v) / 5, i);
              const [lx, ly] = point(cx, cy, R + 26, i);
              const anchor = Math.abs(lx - cx) < 4 ? "middle" : lx > cx ? "start" : "end";
              const label = t(HEX_AXES[i]!.key);
              return (
                <g key={i}>
                  {/* A corner: an 8 px dot with a surface ring, a bigger invisible target for the tooltip. */}
                  {v > 0 ? <circle cx={x} cy={y} r={4} fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth={2} /> : null}
                  <circle cx={x} cy={y} r={12} fill="transparent">
                    <title>{`${label}: ${fmt(v)}/5`}</title>
                  </circle>
                  <text x={lx} y={ly - 3} textAnchor={anchor} className="fill-current text-label" fontSize={13}>
                    {label}
                  </text>
                  <text x={lx} y={ly + 13} textAnchor={anchor} className="fill-current text-primary" fontSize={15} fontWeight={700}>
                    {fmt(v)}
                  </text>
                </g>
              );
            })
          : <title>{summary}</title>}
      </svg>
      <ul className="sr-only">
        {HEX_AXES.map((a, i) => (
          <li key={a.key}>{`${t(a.key)}: ${fmt(values[i]!)}/5`}</li>
        ))}
      </ul>
    </div>
  );
}
