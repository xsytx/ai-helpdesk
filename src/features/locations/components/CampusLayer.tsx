// The campus drawn over the 1st-floor plan (inside FloorPlan's SVG): block
// tints and coloured letters, the lecture halls, the canteen and the medical
// point, with the place you look for outlined and the rest faded a little.
// Shapes are clickable places: a pointer click comes through FloorPlan's
// onPlanClick (see placeAtPlan); keyboard users tab to them here.
import { useLocale } from "@/i18n/LocaleContext";
import { useId, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { BADGE, BLOCKS, CANTEEN, COLOR, ENTRANCES, H, HALLS, MED, PLAN_SCALE, UNIT_TO_PLAN, W, type Pt } from "../campusShapes";
import { ENTRANCE_KEY, PLACES, type Entrance, type SchemeBlock, type SchemeSpot } from "../places";

/** The outlines of the found place (also cut out of the fade over the rest). */
function targetShapes(block?: SchemeBlock, spot?: SchemeSpot): ReactNode[] {
  if (spot === "canteen") return [<rect key="c" x={CANTEEN.x} y={CANTEEN.y} width={CANTEEN.w} height={CANTEEN.h} rx="16" />];
  if (spot === "med") return [<circle key="m" cx={MED[0]} cy={MED[1]} r="36" />];
  if (spot) {
    const h = HALLS[spot.slice(4) as keyof typeof HALLS];
    return [<circle key="h" cx={h.cx} cy={h.cy} r={h.r + 8} />];
  }
  if (!block) return [];
  return BLOCKS[block].map((b, i) => <rect key={i} x={b.x - 6} y={b.y - 6} width={b.w + 12} height={b.h + 12} rx="18" />);
}

export function CampusLayer({ k, blocks = true, block, spot, route, from, onPick }: {
  /** FloorPlan's plan pixels per screen pixel (keeps letters readable at any zoom). */
  k: number;
  /** Block colours, letters, halls and clickable places (off: only the route and entrances). */
  blocks?: boolean;
  /** The place you look for: its block, or a spot (a lecture hall, the canteen, the medical point). */
  block?: SchemeBlock;
  spot?: SchemeSpot;
  /** The walking route from the entrance (scheme units), if any. */
  route?: Pt[] | null;
  /** The entrance the route starts from (drawn bigger). */
  from?: Entrance;
  /** A place picked with the keyboard (pointer clicks come through FloorPlan's onPlanClick). */
  onPick?: (code: string) => void;
}) {
  const { t, locale } = useLocale();
  const maskId = useId();
  // Scheme units per screen pixel: letters, lines and dots keep one size on screen at any zoom.
  const u = k / PLAN_SCALE;
  const badge = 10 * u;
  const end = route?.at(-1);
  const shapes = targetShapes(block, spot);
  const nameOf = (code: string) => PLACES.find((p) => p.code === code)?.name[locale] ?? code;

  const hit = (code: string, shape: ReactNode) => (
    <g
      key={code}
      role={onPick ? "button" : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-label={nameOf(code)}
      // A pointer click is handled by FloorPlan (onPlanClick); detail 0 = a screen reader or keyboard "click".
      onClick={(e: MouseEvent) => {
        if (onPick && e.detail === 0) onPick(code);
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (onPick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onPick(code);
        }
      }}
      className={
        onPick
          ? "cursor-pointer outline-none [&>*]:fill-transparent [&>*]:stroke-transparent [&>*]:transition-colors hover:[&>*]:fill-accent/15 hover:[&>*]:stroke-accent focus-visible:[&>*]:stroke-accent"
          : "[&>*]:fill-transparent"
      }
      strokeWidth="5"
    >
      <title>{nameOf(code)}</title>
      {shape}
    </g>
  );

  return (
    <g transform={UNIT_TO_PLAN}>
      {blocks ? (
        <>
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
        {(Object.keys(HALLS) as (keyof typeof HALLS)[]).map((key) => {
          const h = HALLS[key];
          return (
            <g key={key}>
              <circle cx={h.cx} cy={h.cy} r={h.r} fill="#fde68a" fillOpacity="0.45" stroke="#d97706" strokeOpacity="0.6" strokeWidth="3" />
              <circle cx={h.cx} cy={h.cy} r={Math.min(19, h.r * 0.5)} fill="#d97706" />
              <text x={h.cx} y={h.cy + 8} fontSize="23" fontWeight="700" textAnchor="middle" fill="#fff">{key}</text>
            </g>
          );
        })}
        <rect x={MED[0] - 17} y={MED[1] - 17} width="34" height="34" rx="8" fill="#dc2626" />
        <path d={`M${MED[0] - 10} ${MED[1]}h20M${MED[0]} ${MED[1] - 10}v20`} stroke="#fff" strokeWidth="6" />
      </g>

      {shapes.length > 0 && (
        <g pointerEvents="none">
          {/* Everything but the found place fades a little. */}
          <mask id={maskId}>
            <rect x={-50} y={-50} width={W + 100} height={H + 100} fill="white" />
            <g fill="black">{shapes}</g>
          </mask>
          <rect x={-50} y={-50} width={W + 100} height={H + 100} fill="#fff" opacity="0.45" mask={`url(#${maskId})`} />
          <g fill="none" stroke="var(--color-accent)" strokeWidth={2.5 * u}>{shapes}</g>
        </g>
      )}

        </>
      ) : null}

      {route && (
        <g pointerEvents="none">
          <polyline points={route.map((p) => p.join(",")).join(" ")} fill="none" stroke="#fff" strokeWidth={6 * u} strokeLinejoin="round" strokeLinecap="round" />
          <polyline
            points={route.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--color-accent)" strokeWidth={3.5 * u}
            strokeDasharray={`${7 * u} ${5 * u}`} strokeLinejoin="round" strokeLinecap="round"
          />
          {end && <circle cx={end[0]} cy={end[1]} r={6 * u} fill="var(--color-accent)" stroke="#fff" strokeWidth={2 * u} />}
        </g>
      )}

      {(Object.keys(ENTRANCES) as Entrance[]).map((key) => {
        const [x, y] = ENTRANCES[key].at;
        return (
          <circle key={key} cx={x} cy={y} r={(key === from ? 7 : 5) * u} fill="#dc2626" stroke="#fff" strokeWidth={2 * u} pointerEvents="none">
            <title>{t(ENTRANCE_KEY[key])}</title>
          </circle>
        );
      })}

      {blocks ? (
        <>
      {/* Letters on top of the fade, so every block stays easy to find. */}
      <g pointerEvents="none">
        {(Object.keys(BADGE) as SchemeBlock[]).map((key) => (
          <g key={key}>
            <circle cx={BADGE[key][0]} cy={BADGE[key][1]} r={badge} fill={COLOR[key]} stroke="#fff" strokeWidth={badge / 6} />
            <text x={BADGE[key][0]} y={BADGE[key][1] + badge * 0.37} fontSize={badge * 1.08} fontWeight="700" textAnchor="middle" fill="#fff">{key}</text>
          </g>
        ))}
      </g>

      {/* Clickable places (keyboard and hover; a pointer click goes through FloorPlan). */}
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
        </>
      ) : null}
    </g>
  );
}
