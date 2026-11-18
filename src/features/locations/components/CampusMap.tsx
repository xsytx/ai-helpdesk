// The one map of the Maps page: the real floor plans (zoom, drag, floor tabs)
// with the campus layer on floor 1 (block colours and letters, lecture halls,
// canteen, medical point, clickable places), the walking route from the
// chosen entrance, and the place you look for pinned on its floor. Tap any
// pin to see what it is; "Nearest toilet / stairs" marks the closest one.
// For a place on an upper floor the map opens on floor 1 (the way in) and
// offers to show its floor.
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { safeStorage } from "@/shared/lib/storage";
import { Mascot } from "@/shared/ui/Mascot";
import { ArrowDown, ArrowLeft, ArrowRight, Eraser, Footprints, Layers, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PLAN_SCALE, placeAtPlan, routePoints, type Pt } from "../campusShapes";
import {
  FLOOR_ORDER, PLAN_BLOCKS, TYPE_META, floorOfRoom, pointLabel, pointsFor, useMapPoints,
  type MapFloor, type MapPoint, type PointType,
} from "../mapPoints";
import type { Entrance, Place, RoomCode, SchemeBlock } from "../places";
import { CampusLayer } from "./CampusLayer";
import { FloorPlan } from "./FloorPlan";

const LEGEND: PointType[] = ["room", "toilet", "stairs", "entrance", "canteen", "medical"];
/** The helpers a student asks for, and which point types count. */
const HELPERS: { id: "toilet" | "stairs"; types: PointType[]; key: "mapsNearestToilet" | "mapsNearestStairs" }[] = [
  { id: "toilet", types: ["toilet"], key: "mapsNearestToilet" },
  { id: "stairs", types: ["stairs", "elevator"], key: "mapsNearestStairs" },
];
/** Remembered choice: the campus layer (block colours, halls…) on floor 1. */
const BLOCKS_KEY = "ai_helpdesk_map_blocks";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** A scheme-unit point in plan pixels (see UNIT_TO_PLAN). */
const toPlan = ([x, y]: Pt) => ({ x: PLAN_SCALE * x - 0.6, y: PLAN_SCALE * y + 2 });

/** The closest point of these types on the floor to `from`. */
function nearest(points: MapPoint[], floor: MapFloor, from: { x: number; y: number }, types: PointType[]) {
  let best: MapPoint | undefined;
  for (const p of points) {
    if (p.floor !== floor || !types.includes(p.type)) continue;
    if (!best || dist(p, from) < dist(best, from)) best = p;
  }
  return best;
}

export interface MapPopup { title: string; text: string }

export function CampusMap({ target, from, onPick, onPointPick, popup, onMore, onClosePopup, onClear, guide }: {
  /** The room or place you look for (none = the whole campus). */
  target?: Place | RoomCode;
  from: Entrance;
  /** A block or place clicked on the map (its code in places.ts). */
  onPick?: (code: string) => void;
  /**
   * A pin tapped on the plan: opens the place or room it stands for and
   * returns that target's code, or undefined (a toilet, stairs…: just named
   * under the map).
   */
  onPointPick?: (p: MapPoint) => string | undefined;
  /** The card shown on the map for the place picked there. */
  popup?: MapPopup;
  onMore?: () => void;
  /** Closes only the card; the outline and the route stay. */
  onClosePopup?: () => void;
  /** Clears the picked place: no outline, no route. */
  onClear?: () => void;
  /** What Barys says about the route ("This way: Block F, then up to floor 2!"). */
  guide?: string;
}) {
  const { t } = useLocale();
  const { data: points, isError: pointsFailed } = useMapPoints();
  const room = target && "room" in target ? target : null;
  const place = target && !room ? (target as Place) : null;
  const code = room ? room.code : place?.code;
  const matches = !points || !target ? [] : place?.point ? points.filter((p) => p.id === place.point) : pointsFor(points, code!, place?.rooms);
  const block = target?.block;
  const schemeBlock = block && /^[A-I]$/.test(block) ? (block as SchemeBlock) : undefined;
  const spot = place?.spot;
  const route = target && (schemeBlock || spot) ? routePoints(from, schemeBlock, spot) : null;
  /** The floor the place itself is on (its pin), if known. */
  const declaredFloor: MapFloor | undefined = place?.floor
    ? place.floor >= 4 ? "4" : place.floor === 3 ? "3" : place.floor === 2 ? "2" : "1"
    : undefined;
  const targetFloor: MapFloor | undefined =
    (room ? floorOfRoom(room.floor, room.room) : undefined) ?? matches[0]?.floor ?? declaredFloor;
  // Floor 1 first when there is a way in to show; otherwise straight to the place's floor.
  const startFloor: MapFloor = route ? "1" : (targetFloor ?? "1");

  const [floor, setFloor] = useState<MapFloor>(startFloor);
  const [helper, setHelper] = useState<"toilet" | "stairs">();
  const [tapped, setTapped] = useState<MapPoint>();
  const [showBlocks, setShowBlocks] = useState(() => safeStorage.get(BLOCKS_KEY) !== "off");
  // A place opened by tapping its pin stays on the floor it was tapped on.
  const tappedOn = useRef<{ code: string; floor: MapFloor }>(undefined);
  // Another place or entrance (or the points just loaded): start on its floor again, nothing extra marked.
  useEffect(() => {
    const tap = tappedOn.current;
    setFloor(tap && tap.code === code ? tap.floor : startFloor);
    setHelper(undefined);
    setTapped(undefined);
  }, [code, startFloor, from]);
  const toggleBlocks = () =>
    setShowBlocks((v) => {
      safeStorage.set(BLOCKS_KEY, v ? "off" : "on");
      return !v;
    });

  const all = points ?? [];
  const here = matches.filter((p) => p.floor === floor);
  // Where "nearest" is measured from: the place's pin, else its block's letter.
  const blockSpot = block ? PLAN_BLOCKS.find((b) => b.block === block) : undefined;
  const anchor: { x: number; y: number } | undefined = here[0] ?? (target ? blockSpot : undefined);
  const help = helper && anchor ? nearest(all, floor, anchor, HELPERS.find((h) => h.id === helper)!.types) : undefined;
  const campus = floor === "1" && showBlocks;
  const showRoute = floor === "1" && route;
  // Floor 1 always carries the route and entrances; the blocks only when switched on.
  const layered = floor === "1" && (showBlocks || Boolean(route));

  // What to frame: the place and its helper, else the whole route (with the pin), else the pin.
  let focus: { x: number; y: number; key: string; w?: number } | null = null;
  if (help && anchor) {
    focus = { x: (anchor.x + help.x) / 2, y: (anchor.y + help.y) / 2, w: dist(anchor, help) * 1.6 + 500, key: `${code}-${helper}-${help.id}` };
  } else if (showRoute) {
    const pts = [...route.map(toPlan), ...here];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    focus = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.max(x2 - x1, (y2 - y1) * 2.4) * 1.25 + 300, key: `route-${code}-${from}` };
  } else if (here[0]) {
    focus = { x: here[0].x, y: here[0].y, key: `${code}-${here[0].id}-${here[0].x}-${here[0].y}` };
  }
  const missing = target && points && matches.length === 0 && room;
  const otherFloor = targetFloor && targetFloor !== floor ? targetFloor : undefined;
  const right = route ? route[route.length - 1][0] >= route[0][0] : true;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(target ? HELPERS : []).map((h) => (
            <button
              key={h.id}
              type="button"
              aria-pressed={helper === h.id}
              onClick={() => setHelper(helper === h.id ? undefined : h.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                helper === h.id ? "border-brand bg-brand text-white" : "border-border bg-surface text-primary hover:bg-background-2",
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[h.types[0]].color }} />
              {t(h.key)}
            </button>
          ))}
          {target && onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-primary hover:bg-background-2"
            >
              <Eraser className="h-3.5 w-3.5" />
              {t("mapsClearRoute")}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {floor === "1" ? (
            <button
              type="button"
              aria-pressed={showBlocks}
              onClick={toggleBlocks}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                showBlocks ? "border-brand bg-brand text-white" : "border-border bg-surface text-label hover:text-primary",
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              {t("mapsShowBlocks")}
            </button>
          ) : null}
          <div className="inline-flex rounded-xl border border-border bg-surface p-0.5 text-xs font-semibold" role="group" aria-label={t("mapEditorFloor")}>
            {FLOOR_ORDER.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFloor(f);
                  setTapped(undefined);
                }}
                aria-pressed={floor === f}
                aria-label={t("mapsFloorTab").replace("{floor}", f)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 transition-colors",
                  floor === f ? "bg-brand text-white" : "text-label hover:text-primary",
                  targetFloor === f && floor !== f && "text-accent",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative">
        {(
          <FloorPlan
            floor={floor}
            points={all}
            highlight={here.map((p) => p.id)}
            secondary={help ? [help.id] : []}
            block={here.length === 0 ? block : undefined}
            focus={focus}
            onPointClick={(p) => {
              const opened = onPointPick?.(p);
              if (opened) {
                tappedOn.current = { code: opened, floor: p.floor };
                setFloor(p.floor);
              }
              setTapped(opened ? undefined : p);
            }}
            layer={layered ? (k) => <CampusLayer k={k} blocks={showBlocks} block={schemeBlock} spot={spot} route={route} from={from} onPick={onPick} /> : undefined}
            onPlanClick={
              campus && onPick
                ? (x, y) => {
                    const picked = placeAtPlan(x, y);
                    if (picked) onPick(picked);
                  }
                : undefined
            }
            className="h-[320px] md:h-[440px]"
          />
        )}

        {/* Barys and the way to go, over the plan's corner (quiet while the place's card is open). */}
        {showRoute && guide && !popup ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-2 left-2 z-[5] flex max-w-[70%] items-end gap-1.5 motion-safe:animate-[assistant-in_260ms_cubic-bezier(0.2,0.8,0.2,1)]"
          >
            <Mascot mood={right ? "point-right" : "point-left"} size="sm" />
            <p className="mb-2 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold leading-snug text-primary shadow-md">{guide}</p>
          </div>
        ) : null}

        {/* The place is on another floor: one tap to its floor, and back to the way in. */}
        {target && (otherFloor || (route && floor !== "1")) ? (
          <div className="absolute left-2 top-2 z-[5] flex flex-col items-start gap-1.5">
            {otherFloor ? (
              <button
                type="button"
                onClick={() => {
                  setFloor(otherFloor);
                  setTapped(undefined);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white shadow-md hover:bg-brand-hover"
              >
                {t("mapsShowFloor").replace("{floor}", otherFloor)}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {route && floor !== "1" ? (
              <button
                type="button"
                onClick={() => {
                  setFloor("1");
                  setTapped(undefined);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-primary shadow-md hover:bg-background-2"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("mapsBackToRoute")}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* The card for a place picked on the map. */}
        {popup ? (
          <div className="absolute bottom-2 left-2 z-10 w-64 max-w-[calc(100%-1rem)] rounded-xl border border-border bg-surface p-3 text-left shadow-lg" role="dialog" aria-label={popup.title}>
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
        ) : null}
      </div>

      {pointsFailed ? <p className="mt-2 text-xs text-error">{t("mapsPointsFailed")}</p> : null}
      {helper && anchor && !help ? <p className="mt-2 text-xs text-label">{t("mapsNoneOnFloor")}</p> : null}
      {help ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-label">
          <Footprints className="h-3.5 w-3.5" />
          {t("mapsHelperMarked").replace("{name}", pointLabel(help, t))}
        </p>
      ) : null}
      {tapped ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-background-2 px-3 py-2 text-sm text-primary" role="status">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TYPE_META[tapped.type].color }} />
          <span className="min-w-0 flex-1">
            <b>{pointLabel(tapped, t)}</b>
            <span className="text-label">
              {" · "}
              {[tapped.name && tapped.code ? tapped.code : "", t(TYPE_META[tapped.type].key), t("mapsFloorTab").replace("{floor}", tapped.floor)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <button type="button" onClick={() => setTapped(undefined)} aria-label={t("close")} className="rounded-lg p-1 text-label hover:bg-surface">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {missing ? (
        <p className="mt-2 text-xs text-label">{t("mapsNotOnPlan").replace("{code}", code!).replace("{block}", block ?? "")}</p>
      ) : null}

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-label">
        {layered ? (
          <>
            {route ? <Dot className="bg-accent" label={t("mapsLegendRoute")} /> : null}
            <Dot className="bg-red-600" label={t("mapsLegendEntrance")} />
            {campus ? <Dot className="bg-amber-500" label={t("mapsHalls")} /> : null}
          </>
        ) : null}
        {LEGEND.map((type) => (
          <span key={type} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_META[type].color }} />
            {t(TYPE_META[type].key)}
          </span>
        ))}
        <span>· {t("mapsFloorPlanHint")}</span>
      </p>
      {campus ? <p className="mt-1 text-[11px] text-label">{t("mapsSchemeNote")}</p> : null}
    </section>
  );
}

function Dot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      {label}
    </span>
  );
}
