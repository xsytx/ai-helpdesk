// Simplified scheme of the main building's 1st floor, drawn from data (not the
// official map image), left to right like the building: A–C at the west end,
// the main corridor with the wings D–I on one side and the round lecture
// halls ("bochkas"), the canteen and the G/H buildings on the other.
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import type { Entrance, SchemeBlock, SchemeSpot } from "../places";

type Pt = [number, number];
interface Box { x: number; y: number; w: number; h: number; sub?: TranslationKey; dashed?: boolean }

const CORRIDOR_Y = 176;
const CORRIDOR_START = 124;

const BLOCKS: Record<SchemeBlock, Box> = {
  A: { x: 26, y: 20, w: 92, h: 62, sub: "mapsSubHall" },
  B: { x: 10, y: 88, w: 108, h: 78, sub: "mapsSubLibrary" },
  C: { x: 44, y: 190, w: 120, h: 96, sub: "mapsSubAtrium" },
  D: { x: 150, y: 36, w: 72, h: 128 },
  E: { x: 245, y: 36, w: 72, h: 128 },
  F: { x: 340, y: 36, w: 72, h: 128 },
  G: { x: 435, y: 36, w: 72, h: 128 },
  H: { x: 530, y: 36, w: 72, h: 128 },
  I: { x: 625, y: 36, w: 72, h: 128, dashed: true },
};
const WINGS: SchemeBlock[] = ["D", "E", "F", "G", "H", "I"];
/** The G and H buildings across the corridor belong to those blocks. */
const ANNEXES: Partial<Record<SchemeBlock, Box>> = {
  G: { x: 462, y: 200, w: 70, h: 84 },
  H: { x: 540, y: 196, w: 94, h: 92 },
};

const HALLS: Record<"A" | "B" | "C" | "D", { cx: number; cy: number; r: number }> = {
  A: { cx: 200, cy: 236, r: 20 },
  B: { cx: 238, cy: 212, r: 16 },
  C: { cx: 278, cy: 238, r: 20 },
  D: { cx: 330, cy: 220, r: 18 },
};
const CANTEEN = { x: 362, y: 196, w: 90, h: 56 };
const MED: Pt = [518, CORRIDOR_Y];

const ENTRANCES: Record<Entrance, { at: Pt; way: Pt[] }> = {
  // Through the atrium (block C) to the west end of the corridor.
  C: { at: [60, 302], way: [[150, 302], [150, CORRIDOR_Y]] },
  // Through the G building to the corridor.
  G: { at: [482, 302], way: [[497, 242], [497, CORRIDOR_Y]] },
};

function spotPoint(spot: SchemeSpot): { corridor: number; end: Pt } {
  if (spot === "canteen") return { corridor: CANTEEN.x + CANTEEN.w / 2, end: [CANTEEN.x + CANTEEN.w / 2, CANTEEN.y] };
  if (spot === "med") return { corridor: MED[0], end: MED };
  const h = HALLS[spot.slice(4) as keyof typeof HALLS];
  return { corridor: h.cx, end: [h.cx, h.cy - h.r] };
}

/** The dashed route from an entrance to the place, along the main corridor. */
function routePoints(from: Entrance, block?: SchemeBlock, spot?: SchemeSpot): Pt[] | null {
  const { at, way } = ENTRANCES[from];
  const start: Pt[] = [at, ...way];
  if (block === "C" && from === "C") return [at, [104, 260]];
  const along = (x: number): Pt[] => [...start, [x, CORRIDOR_Y]];
  if (spot) {
    const { corridor, end } = spotPoint(spot);
    return [...along(corridor), end];
  }
  if (!block) return null;
  if (WINGS.includes(block)) {
    const cx = BLOCKS[block].x + BLOCKS[block].w / 2;
    return [...along(cx), [cx, BLOCKS[block].y + BLOCKS[block].h]];
  }
  if (block === "A") return [...along(CORRIDOR_START), [CORRIDOR_START, 51], [118, 51]];
  if (block === "B") return [...along(CORRIDOR_START), [CORRIDOR_START, 127], [118, 127]];
  return [...along(CORRIDOR_START), [CORRIDOR_START, 192]];
}

export function CampusScheme({ block, spot, from }: { block?: SchemeBlock; spot?: SchemeSpot; from: Entrance }) {
  const { t } = useLocale();
  const route = routePoints(from, block, spot);
  const end = route?.at(-1);
  const hallOn = spot?.startsWith("hall") ? spot.slice(4) : undefined;

  const blockBox = (key: SchemeBlock, b: Box) => {
    const on = key === block;
    return (
      <rect
        x={b.x} y={b.y} width={b.w} height={b.h} rx="8"
        fill={on ? "var(--color-brand)" : "var(--color-surface)"}
        stroke={on ? "var(--color-brand)" : "var(--color-border)"}
        strokeDasharray={b.dashed && !on ? "5 4" : undefined}
      />
    );
  };

  return (
    <figure className="m-0">
      <div className="overflow-x-auto rounded-2xl bg-page">
      <svg viewBox="0 0 720 334" role="img" aria-label={t("mapsSchemeTitle")} className="h-auto w-full min-w-[560px]">
        <rect x={CORRIDOR_START - 6} y={CORRIDOR_Y - 6} width={600} height={12} rx="6" fill="var(--color-border)" />

        {(Object.keys(ANNEXES) as SchemeBlock[]).map((key) => (
          <g key={`annex-${key}`}>{blockBox(key, ANNEXES[key]!)}</g>
        ))}
        <circle cx="587" cy="242" r="20" fill="none" stroke={block === "H" ? "#fff" : "var(--color-border)"} />

        {(Object.keys(BLOCKS) as SchemeBlock[]).map((key) => {
          const b = BLOCKS[key];
          const on = key === block;
          return (
            <g key={key}>
              {blockBox(key, b)}
              <text x={b.x + 9} y={b.y + 20} fontSize="15" fontWeight="700" fill={on ? "#fff" : "var(--color-primary)"}>{key}</text>
              {b.sub && <text x={b.x + 9} y={b.y + 36} fontSize="10" fill={on ? "#fff" : "var(--color-label)"}>{t(b.sub)}</text>}
            </g>
          );
        })}

        {(Object.keys(HALLS) as (keyof typeof HALLS)[]).map((key) => {
          const h = HALLS[key];
          const on = hallOn === key;
          return (
            <g key={key}>
              <circle cx={h.cx} cy={h.cy} r={h.r} fill={on ? "var(--color-accent)" : "var(--color-amber-200)"} />
              <text x={h.cx} y={h.cy + 4} fontSize="11" fontWeight="700" textAnchor="middle" fill={on ? "#fff" : "var(--color-amber-900)"}>{key}</text>
            </g>
          );
        })}
        <text x="265" y="278" fontSize="10" textAnchor="middle" fill="var(--color-label)">{t("mapsHalls")}</text>

        <rect
          x={CANTEEN.x} y={CANTEEN.y} width={CANTEEN.w} height={CANTEEN.h} rx="8"
          fill={spot === "canteen" ? "var(--color-accent)" : "var(--color-sky-50)"}
          stroke={spot === "canteen" ? "var(--color-accent)" : "var(--color-border)"}
        />
        <text x={CANTEEN.x + CANTEEN.w / 2} y={CANTEEN.y + 32} fontSize="11" fontWeight="600" textAnchor="middle" fill={spot === "canteen" ? "#fff" : "var(--color-sky-700)"}>
          {t("mapsCanteen")}
        </text>

        <g>
          <rect x={MED[0] - 7} y={MED[1] - 7} width="14" height="14" rx="3" fill={spot === "med" ? "var(--color-accent)" : "var(--color-red-600)"} />
          <path d={`M${MED[0] - 4} ${MED[1]}h8M${MED[0]} ${MED[1] - 4}v8`} stroke="#fff" strokeWidth="2" />
        </g>

        {route && (
          <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeDasharray="7 5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {(Object.keys(ENTRANCES) as Entrance[]).map((key) => {
          const [x, y] = ENTRANCES[key].at;
          return (
            <g key={key}>
              <circle cx={x} cy={y} r={key === from ? 8 : 6} fill="var(--color-red-600)" />
              <text x={x} y={y + 22} fontSize="11" fontWeight="600" textAnchor="middle" fill="var(--color-red-600)">
                {key === "C" ? t("mapsEntranceC") : t("mapsEntranceG")}
              </text>
            </g>
          );
        })}

        {end && <circle cx={end[0]} cy={end[1]} r="7" fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth="3" />}
      </svg>
      </div>
      <figcaption className="mt-3 space-y-2 text-xs text-label">
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <Legend className="bg-brand" label={t("mapsLegendBlock")} />
          <Legend className="bg-accent" label={t("mapsLegendRoute")} />
          <Legend className="bg-red-600" label={t("mapsLegendEntrance")} />
          <Legend className="bg-amber-200" label={t("mapsHalls")} />
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-3 w-3 items-center justify-center rounded-[3px] bg-red-600 text-[9px] font-bold leading-none text-white">+</span>
            {t("mapsMed")}
          </span>
        </span>
        <span className="block">{t("mapsSchemeNote")}</span>
      </figcaption>
    </figure>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      {label}
    </span>
  );
}
