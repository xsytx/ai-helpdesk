// The 1st-floor plan of the main building (public/maps/floor1.png, the full
// plan the map points were collected on) with the blocks tinted and lettered
// like the Freshman's guide map, the found place outlined, and the walking
// route from the chosen entrance. Coordinates here are scheme units (the plan
// at 1/PLAN_SCALE of its pixels; see PLAN_*), which is what every block,
// hall and route below was traced in. Routes only use walkable space: the
// atrium, the hall below the wings (with the big hall under H and I at its
// east end), each wing's passage, and the doors of the canteen and halls.
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Mascot } from "@/shared/ui/Mascot";
import { ArrowDown, Eraser, X } from "lucide-react";
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { ENTRANCE_KEY, PLACES, type Entrance, type SchemeBlock, type SchemeSpot } from "../places";

type Pt = [number, number];
interface Box { x: number; y: number; w: number; h: number }

/**
 * The full plan image (4818 × 1689 px) in scheme units: plan pixel = PLAN_SCALE
 * × scheme unit + offset, measured on six wing passages and the lecture halls.
 * Room points (map_points) use plan pixels; this scheme uses the units.
 */
const PLAN_SCALE = 2.3653;
const PLAN_X = 0.6 / PLAN_SCALE;
const PLAN_Y = -2 / PLAN_SCALE;
const PLAN_W = 4818 / PLAN_SCALE;
const PLAN_H = 1689 / PLAN_SCALE;
/** The drawing area: wide enough for the east wall and Entrance I. */
const W = 2040;
const H = 714;

/** One colour per block, as on the campus map. */
const COLOR: Record<SchemeBlock, string> = {
  A: "#c95a4f", B: "#b8975a", C: "#3f8a73", D: "#8a4aa8", E: "#9b3a3e",
  F: "#3d4a96", G: "#5f8a3f", H: "#3b6fb5", I: "#e07a1a",
};

const box = (x1: number, y1: number, x2: number, y2: number): Box => ({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
const BLOCKS: Record<SchemeBlock, Box[]> = {
  A: [box(100, 35, 335, 180)],
  B: [box(30, 182, 302, 408)],
  C: [box(180, 412, 425, 675)],
  D: [box(466, 175, 607, 410)],
  E: [box(738, 175, 887, 410)],
  F: [box(986, 175, 1137, 410)],
  G: [box(1261, 175, 1402, 410), box(1255, 458, 1475, 685)],
  H: [box(1541, 175, 1687, 410), box(1476, 468, 1720, 625)],
  I: [box(1811, 175, 1968, 410)],
};
/** Where each block's letter badge sits. */
const BADGE: Record<SchemeBlock, Pt> = {
  A: [70, 108], B: [58, 352], C: [138, 560],
  D: [536, 140], E: [812, 140], F: [1061, 140], G: [1331, 140], H: [1614, 140], I: [1889, 140],
};

const HALLS: Record<"A" | "B" | "C" | "D", { cx: number; cy: number; r: number }> = {
  A: { cx: 484, cy: 550, r: 53 },
  B: { cx: 577, cy: 497, r: 38 },
  C: { cx: 685, cy: 550, r: 51 },
  D: { cx: 830, cy: 500, r: 39 },
};
const CANTEEN = box(962, 462, 1205, 610);
const MED: Pt = [1447, 392];

// Walkways, traced on the plan image. The wings' bottom strip (y 370–415)
// holds rooms (toilets, shop, medical point), so routes never run along it:
// the walkway is the hall just below it (HALL_Y), and each wing is entered
// through its passage between its two stairwells (WING_DOOR_X).
const HALL_Y = 447;
/** East of the H passage the hall runs a little lower, below the stairs in it. */
const HALL_Y_EAST = 458;
const HALL_EAST_FROM = 1570;
const hallY = (x: number) => (x >= HALL_EAST_FROM ? HALL_Y_EAST : HALL_Y);

/** The passage up into each wing (between the wing's two stairwells). */
const WING_DOOR_X: Partial<Record<SchemeBlock, number>> = { D: 552, E: 824, F: 1074, G: 1350, H: 1628, I: 1899 };
/** How far up the wing's own corridor the route goes. */
const WING_END_Y = 300;

/** Atrium side: from the C entrance hall up to the hall (west end of the walkway). */
const C_TO_HALL: Pt[] = [[262, 612], [300, 578], [350, 505], [368, 496], [400, 478], [425, HALL_Y]];
/** From the gap east of the atrium to block B's hall (through the atrium's north side and its glass door). */
const ATRIUM_TO_B: Pt[] = [[338, 483], [322, 452], [275, 430], [250, 417], [225, 395], [205, 330]];

/** Each entrance and the way from it to the walkway. */
const ENTRANCES: Record<Entrance, { at: Pt; toHall: Pt[] }> = {
  // Main entrance: the glass entrance hall of block C, then past the atrium.
  C: { at: [228, 650], toHall: C_TO_HALL },
  // Through the G building to the hall.
  G: { at: [1316, 656], toHall: [[1312, 615], [1343, 560], [1343, 470], [1343, HALL_Y]] },
  // East entrance: on the east wall of the big hall under blocks H and I.
  I: { at: [1995, 469], toHall: [[1960, HALL_Y_EAST]] },
};

/** Along the walkway from x1 to x2 (a step down to the lower eastern part on the way). */
function alongHall(x1: number, x2: number): Pt[] {
  const out: Pt[] = [];
  const east = HALL_EAST_FROM;
  if (x1 < east && x2 >= east) out.push([east - 15, HALL_Y], [east + 15, HALL_Y_EAST]);
  if (x1 >= east && x2 < east) out.push([east + 15, HALL_Y_EAST], [east - 15, HALL_Y]);
  out.push([x2, hallY(x2)]);
  return out;
}

/** The route from an entrance to the place, along walkable space only. */
function routePoints(from: Entrance, block?: SchemeBlock, spot?: SchemeSpot): Pt[] | null {
  const { at, toHall } = ENTRANCES[from];
  const hallStart = toHall[toHall.length - 1];
  /** From the entrance along the walkway to x. */
  const toX = (x: number): Pt[] => [at, ...toHall, ...alongHall(hallStart[0], x)];
  /** To the gap east of the atrium (where the ways to blocks A, B and C start). */
  const toAtrium = (): Pt[] =>
    from === "C" ? [at, ...C_TO_HALL.slice(0, 3)] : [...toX(425), [400, 478], [368, 496], [350, 505]];

  if (spot?.startsWith("hall")) {
    const h = HALLS[spot.slice(4) as keyof typeof HALLS];
    return [...toX(h.cx), [h.cx, h.cy - h.r]];
  }
  // The canteen's door is on its north side, towards the walkway.
  if (spot === "canteen") return [...toX(1032), [1032, 500]];
  if (spot === "med") return [...toX(MED[0]), [MED[0], MED[1] + 6]];
  if (!block) return null;

  if (block === "H") {
    // The hall's stairs sit right under H's passage: go round them on the west.
    const door = WING_DOOR_X.H!;
    return [...toX(1600), [1620, 425], [door, 410], [door, WING_END_Y]];
  }
  const door = WING_DOOR_X[block];
  if (door !== undefined) return [...toX(door), [door, 412], [door, WING_END_Y]];

  if (block === "C") return from === "C" ? [at, [262, 612], [300, 578], [318, 560]] : [...toAtrium(), [318, 560]];
  if (block === "B") return [...toAtrium(), ...ATRIUM_TO_B];
  // Block A: through block B's hall and north to the A building.
  return [...toAtrium(), ...ATRIUM_TO_B, [200, 230], [215, 115]];
}

/** The outlines of the found place (also cut out of the fade over the rest). */
function highlight(block?: SchemeBlock, spot?: SchemeSpot) {
  if (spot === "canteen") return [<rect key="c" x={CANTEEN.x} y={CANTEEN.y} width={CANTEEN.w} height={CANTEEN.h} rx="16" />];
  if (spot === "med") return [<circle key="m" cx={MED[0]} cy={MED[1]} r="36" />];
  if (spot) {
    const h = HALLS[spot.slice(4) as keyof typeof HALLS];
    return [<circle key="h" cx={h.cx} cy={h.cy} r={h.r + 8} />];
  }
  if (!block) return [];
  return BLOCKS[block].map((b, i) => <rect key={i} x={b.x - 6} y={b.y - 6} width={b.w + 12} height={b.h + 12} rx="18" />);
}

/** Where the card for a place picked on the map points: above the shape, or below it near the top edge. */
function anchorOf(block?: SchemeBlock, spot?: SchemeSpot): { x: number; y: number; below: boolean } | null {
  let top: Pt, bottom: Pt;
  if (spot === "canteen") [top, bottom] = [[CANTEEN.x + CANTEEN.w / 2, CANTEEN.y], [CANTEEN.x + CANTEEN.w / 2, CANTEEN.y + CANTEEN.h]];
  else if (spot === "med") [top, bottom] = [[MED[0], MED[1] - 30], [MED[0], MED[1] + 30]];
  else if (spot) {
    const h = HALLS[spot.slice(4) as keyof typeof HALLS];
    [top, bottom] = [[h.cx, h.cy - h.r], [h.cx, h.cy + h.r]];
  } else if (block) {
    const b = BLOCKS[block][0];
    [top, bottom] = [[b.x + b.w / 2, b.y], [b.x + b.w / 2, b.y + b.h]];
  } else return null;
  const below = top[1] < 260;
  const [x, y] = below ? bottom : top;
  return { x, y, below };
}

export interface SchemePopup { title: string; text: string }

export function CampusScheme({ block, spot, from, onPick, popup, onMore, onClosePopup, onClear, guide }: {
  block?: SchemeBlock;
  spot?: SchemeSpot;
  from: Entrance;
  /** A place clicked on the map (its code in PLACES). */
  onPick?: (code: string) => void;
  /** The card shown on the map for the place picked there. */
  popup?: SchemePopup;
  onMore?: () => void;
  /** Closes only the card; the outline and the route stay. */
  onClosePopup?: () => void;
  /** Clears the picked place: no outline, no route. */
  onClear?: () => void;
  /** What Barys says next to the route ("This way: Block F, then up to floor 2!"). */
  guide?: string;
}) {
  const { t, locale } = useLocale();
  const maskId = useId();
  const route = routePoints(from, block, spot);
  const end = route?.at(-1);
  const shapes = highlight(block, spot);
  const anchor = popup ? anchorOf(block, spot) : null;
  const nameOf = (code: string) => PLACES.find((p) => p.code === code)?.name[locale] ?? code;

  const hit = (code: string, shape: ReactNode) => (
    <g
      key={code}
      role="button"
      tabIndex={0}
      aria-label={nameOf(code)}
      onClick={() => onPick?.(code)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick?.(code);
        }
      }}
      className="cursor-pointer outline-none [&>*]:fill-transparent [&>*]:stroke-transparent [&>*]:transition-colors hover:[&>*]:fill-accent/15 hover:[&>*]:stroke-accent focus-visible:[&>*]:stroke-accent"
      strokeWidth="5"
    >
      <title>{nameOf(code)}</title>
      {shape}
    </g>
  );

  return (
    <figure className="m-0">
      <div className="overflow-x-auto rounded-2xl border border-border/60 bg-white">
        <div className="relative min-w-[720px]">
          <svg viewBox={`0 0 ${W} ${H}`} aria-label={t("mapsSchemeTitle")} className="block h-auto w-full">
            <image href="/maps/floor1.png" x={PLAN_X} y={PLAN_Y} width={PLAN_W} height={PLAN_H} />

            {/* Block tints, the canteen, the lecture halls and the medical point. */}
            <g pointerEvents="none">
              {(Object.keys(BLOCKS) as SchemeBlock[]).map((key) =>
                BLOCKS[key].map((b, i) => (
                  <rect
                    key={`${key}${i}`} x={b.x} y={b.y} width={b.w} height={b.h} rx="16"
                    fill={COLOR[key]} fillOpacity="0.12" stroke={COLOR[key]} strokeOpacity="0.55" strokeWidth="3"
                  />
                )),
              )}
              <rect x={CANTEEN.x} y={CANTEEN.y} width={CANTEEN.w} height={CANTEEN.h} rx="16" fill="#0ea5e9" fillOpacity="0.1" stroke="#0369a1" strokeOpacity="0.4" strokeWidth="3" />
              <g transform={`translate(${CANTEEN.x + CANTEEN.w / 2 + 70} ${CANTEEN.y + 30})`}>
                <circle r="20" fill="#0369a1" />
                {/* fork and knife */}
                <path d="M-7 -10v8a4 4 0 0 0 4 4v8M-3 -10v8M1 -10v8M6 -10c-3 2-3 9 0 11v9" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
              </g>
              {(Object.keys(HALLS) as (keyof typeof HALLS)[]).map((key) => {
                const h = HALLS[key];
                return (
                  <g key={key}>
                    <circle cx={h.cx} cy={h.cy} r={h.r} fill="#fde68a" fillOpacity="0.45" stroke="#d97706" strokeOpacity="0.6" strokeWidth="3" />
                    <circle cx={h.cx} cy={h.cy} r="19" fill="#d97706" />
                    <text x={h.cx} y={h.cy + 8} fontSize="23" fontWeight="700" textAnchor="middle" fill="#fff">{key}</text>
                  </g>
                );
              })}
              <rect x={MED[0] - 17} y={MED[1] - 17} width="34" height="34" rx="8" fill="#dc2626" />
              <path d={`M${MED[0] - 10} ${MED[1]}h20M${MED[0]} ${MED[1] - 10}v20`} stroke="#fff" strokeWidth="6" />
              {(Object.keys(BADGE) as SchemeBlock[]).map((key) => (
                <g key={key}>
                  <circle cx={BADGE[key][0]} cy={BADGE[key][1]} r="24" fill={COLOR[key]} stroke="#fff" strokeWidth="4" />
                  <text x={BADGE[key][0]} y={BADGE[key][1] + 9} fontSize="26" fontWeight="700" textAnchor="middle" fill="#fff">{key}</text>
                </g>
              ))}
            </g>

            {shapes.length > 0 && (
              <g pointerEvents="none">
                {/* Everything but the found place fades a little. */}
                <mask id={maskId}>
                  <rect width={W} height={H} fill="white" />
                  <g fill="black">{shapes}</g>
                </mask>
                <rect width={W} height={H} fill="#fff" opacity="0.55" mask={`url(#${maskId})`} />
                <g fill="none" stroke="var(--color-accent)" strokeWidth="7">{shapes}</g>
              </g>
            )}

            {route && (
              <g pointerEvents="none">
                <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none" stroke="#fff" strokeWidth="16" strokeLinejoin="round" strokeLinecap="round" />
                <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--color-accent)" strokeWidth="9" strokeDasharray="20 14" strokeLinejoin="round" strokeLinecap="round" />
                {end && <circle cx={end[0]} cy={end[1]} r="17" fill="var(--color-accent)" stroke="#fff" strokeWidth="6" />}
              </g>
            )}

            {(Object.keys(ENTRANCES) as Entrance[]).map((key) => {
              const [x, y] = ENTRANCES[key].at;
              return (
                <circle key={key} cx={x} cy={y} r={key === from ? 17 : 12} fill="#dc2626" stroke="#fff" strokeWidth="5" pointerEvents="none">
                  <title>{t(ENTRANCE_KEY[key])}</title>
                </circle>
              );
            })}

            {/* Clickable places: blocks, lecture halls, the canteen, the medical point. */}
            {onPick && (
              <g>
                {(Object.keys(BLOCKS) as SchemeBlock[]).map((key) =>
                  hit(`BLOCK_${key}`, BLOCKS[key].map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="16" />)),
                )}
                {hit("RED_CANTEEN", <rect x={CANTEEN.x} y={CANTEEN.y} width={CANTEEN.w} height={CANTEEN.h} rx="16" />)}
                {(Object.keys(HALLS) as (keyof typeof HALLS)[]).map((key) =>
                  hit(`HALL_${key}`, <circle cx={HALLS[key].cx} cy={HALLS[key].cy} r={HALLS[key].r} />),
                )}
                {hit("MEDICAL", <circle cx={MED[0]} cy={MED[1]} r="30" />)}
              </g>
            )}
          </svg>

          {route && end && guide && <RouteGuide start={route[0]} end={end} text={guide} quiet={Boolean(popup && anchor)} />}

          {(block || spot) && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-primary shadow-sm hover:bg-background-2"
            >
              <Eraser className="h-3.5 w-3.5" />
              {t("mapsClearRoute")}
            </button>
          )}
          {popup && anchor && (
            <div
              className="absolute z-10 w-60 rounded-xl border border-border bg-surface p-3 text-left shadow-lg"
              style={{
                left: `${(anchor.x / W) * 100}%`,
                top: `${(anchor.y / H) * 100}%`,
                transform: `translate(${anchor.x / W > 0.8 ? "-92%" : anchor.x / W < 0.2 ? "-8%" : "-50%"}, ${anchor.below ? "12px" : "calc(-100% - 12px)"})`,
              }}
              role="dialog"
              aria-label={popup.title}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-primary">{popup.title}</p>
                <button type="button" onClick={onClosePopup} aria-label={t("close")} className="-mr-1 -mt-1 rounded-lg p-1 text-label hover:bg-background-2">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 text-sm text-label">{popup.text}</p>
              <button type="button" onClick={onMore} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline dark:text-primary">
                <ArrowDown className="h-4 w-4" />
                {t("mapsMore")}
              </button>
            </div>
          )}
        </div>
      </div>
      <figcaption className="mt-3 space-y-2 text-xs text-label">
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <Legend className="bg-accent" label={t("mapsLegendRoute")} />
          <Legend className="bg-red-600" label={t("mapsLegendEntrance")} />
          <Legend className="bg-amber-500" label={t("mapsHalls")} />
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-3 w-3 items-center justify-center rounded-[3px] bg-red-600 text-[9px] font-bold leading-none text-white">+</span>
            {t("mapsMed")}
          </span>
          <Legend className="bg-sky-700" label={t("mapsCanteen")} />
        </span>
        <span className="block">{t("mapsSchemeNote")}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Barys next to the entrance the route starts from, pointing the way it goes
 * (towards the place: left or right), with the short directions in a bubble.
 * While the place's card is open on the map he keeps quiet (no bubble).
 */
function RouteGuide({ start, end, text, quiet }: { start: Pt; end: Pt; text: string; quiet: boolean }) {
  const right = end[0] >= start[0];
  // Entrance I is near the plan's right edge with the walkway above it: Barys
  // stands in the empty space below it instead, his bubble under him.
  const below = start[0] > W * 0.8;
  const bubble = !quiet && (
    <p className="relative w-max max-w-[11rem] rounded-xl border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold leading-snug text-primary shadow-md">
      {text}
      <span
        className={cn(
          "absolute h-3 w-3 rotate-45 border-border bg-surface",
          below ? "-top-1.5 right-5 border-l border-t" : "-bottom-1.5 left-5 border-b border-r",
        )}
      />
    </p>
  );
  return (
    <div
      // A new route: he appears again (the key restarts the fade-in).
      key={`${start.join()}-${end.join()}`}
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-[5] flex flex-col gap-1 motion-safe:animate-[assistant-in_260ms_cubic-bezier(0.2,0.8,0.2,1)]",
        below ? "items-end" : "items-start",
      )}
      style={{
        left: `${(start[0] / W) * 100}%`,
        top: `${(start[1] / H) * 100}%`,
        // Just right of and above the entrance dot; for Entrance I, below it and to its left.
        transform: below ? "translate(calc(-100% + 20px), 14px)" : "translate(16px, calc(-100% + 16px))",
      }}
    >
      {below ? null : bubble}
      <Mascot mood={right ? "point-right" : "point-left"} size="sm" />
      {below ? bubble : null}
    </div>
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
