// The one map of the Maps page: the real floor plans (zoom, drag, floor tabs)
// with the campus layer on floor 1 (block colours and letters, lecture halls,
// canteen, medical point, clickable places), the walking route from the
// chosen entrance, and the place you look for pinned on its floor. Tap any
// pin to see what it is; "Nearest toilet / stairs" marks the closest one.
// For a place on an upper floor the map opens on floor 1 (the way in), the
// route ends at the wing's elevator, and the elevator is marked on the
// place's floor too (where you come out).
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { safeStorage } from "@/shared/lib/storage";
import { Mascot } from "@/shared/ui/Mascot";
import { ArrowDown, ArrowLeft, ArrowRight, ChevronDown, Eraser, Expand, Footprints, Layers, Shrink, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PLAN_SCALE, WING_DOOR_X, placeAtPlan, planToUnit, routeBetween, routePoints, upperToFloor1, type Pt } from "../campusShapes";
import {
  FLOOR_ORDER, PLAN_BLOCKS, TYPE_META, floorOfRoom, levelOf, pointLabel, pointsFor, useMapPoints,
  type MapFloor, type MapPoint, type PointType,
} from "../mapPoints";
import { ENTRANCE_KEY, blockOnFloor, type Entrance, type Place, type RoomCode, type SchemeBlock, type SchemeSpot } from "../places";
import { corridorPath } from "../upstairs";
import { CampusLayer } from "./CampusLayer";
import { FloorPlan } from "./FloorPlan";

const LEGEND: PointType[] = ["room", "toilet", "stairs", "entrance", "canteen", "medical"];
/** The helpers a student asks for, and which point types count. */
const HELPERS: { id: "toilet" | "stairs"; types: PointType[]; key: "mapsNearestToilet" | "mapsNearestStairs" }[] = [
  { id: "toilet", types: ["toilet"], key: "mapsNearestToilet" },
  { id: "stairs", types: ["stairs", "elevator"], key: "mapsNearestStairs" },
];
/** Remembered choice: the campus layer (block colours, halls…; upstairs only the blocks). */
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

const isLift = (p: MapPoint) => p.type === "elevator";
/** Stairs without a name go to every floor (the ones at the far end of each wing). */
const isFullStairs = (p: MapPoint) => p.type === "stairs" && !p.name;
/** The closest matching point to `at` on the floor, if it is in the same wing (within ~a wing). */
function nearWing(points: MapPoint[], floor: MapFloor, at: { x: number; y: number }, match: (p: MapPoint) => boolean = isLift) {
  let best: MapPoint | undefined;
  for (const p of points) {
    if (p.floor !== floor || !match(p)) continue;
    if (!best || dist(p, at) < dist(best, at)) best = p;
  }
  return best && dist(best, at) < 450 ? best : undefined;
}

export interface MapPopup { title: string; text: string }

/** Where a room or place is: its pins, block, spot on the scheme and floor. */
function locate(target: Place | RoomCode, points: MapPoint[] | undefined) {
  const room = "room" in target ? target : null;
  const place = room ? null : (target as Place);
  const code = room ? room.code : place!.code;
  const matches = !points ? [] : place?.point ? points.filter((p) => p.id === place.point) : pointsFor(points, code, place?.rooms);
  const block = target.block;
  const schemeBlock = block && /^[A-I]$/.test(block) ? (block as SchemeBlock) : undefined;
  const spot: SchemeSpot | undefined = place?.spot;
  const declaredFloor: MapFloor | undefined = place?.floor
    ? place.floor >= 4 ? "4" : place.floor === 3 ? "3" : place.floor === 2 ? "2" : "1"
    : undefined;
  const floor: MapFloor | undefined = (room ? floorOfRoom(room.floor, room.room) : undefined) ?? matches[0]?.floor ?? declaredFloor;
  const level = room ? levelOf(room.floor, room.room) : place?.floor ? String(place.floor) : undefined;
  /** Upstairs in a wing: reached by the wing's elevator. */
  const upWing = Boolean(floor && floor !== "1" && schemeBlock && WING_DOOR_X[schemeBlock] !== undefined);
  return { room, place, code, matches, block, schemeBlock, spot, floor, level, upWing };
}

export function CampusMap({ target, marked, from, start, showFloor, onFloorChange, onPick, onPointPick, popup, onMore, onClosePopup, onClear, guide }: {
  /** The room or place you look for (none = the whole campus). */
  target?: Place | RoomCode;
  /** A category chip's places, marked on the map while nothing is picked. */
  marked?: Place[];
  from: Entrance;
  /** A room or place the route starts from instead of the entrance (F205 → F310). */
  start?: Place | RoomCode;
  /** Show this floor (a step tapped under the map); `n` changes with every tap. */
  showFloor?: { floor: MapFloor; n: number };
  /** The floor on screen changed. */
  onFloorChange?: (floor: MapFloor) => void;
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
  const { t, locale } = useLocale();
  const { data: points, isError: pointsFailed } = useMapPoints();
  const all = points ?? [];
  const end = target ? locate(target, points) : undefined;
  const room = end?.room ?? null;
  const place = end?.place ?? null;
  const code = end?.code;
  const matches = end?.matches ?? [];
  const block = end?.block;
  const schemeBlock = end?.schemeBlock;
  const spot = end?.spot;
  const targetFloor = end?.floor;
  const level = end?.level;
  // The start (a room or place instead of an entrance), when it isn't the place itself.
  const startAt = start ? locate(start, points) : undefined;
  const begin = startAt && end && startAt.code !== end.code ? startAt : undefined;
  // Both upstairs in one wing: just the elevator, no floor-1 walk.
  const oneWing = Boolean(begin?.upWing && end?.upWing && begin.schemeBlock === schemeBlock);
  const walk = !end
    ? null
    : begin
      ? oneWing ? null : routeBetween({ block: begin.schemeBlock, spot: begin.spot }, { block: schemeBlock, spot })
      : schemeBlock || spot ? routePoints(from, schemeBlock, spot) : null;
  // Upstairs in a wing: the route ends at the wing's elevator (on its corridor,
  // so the walk is the same), marked on floor 1 and on the place's floor.
  // Starting upstairs, it begins at the elevator you come down in.
  const upstairs = Boolean(end?.upWing && (walk || oneWing));
  const liftDown = upstairs && walk ? nearWing(all, "1", toPlan(walk[walk.length - 1])) : undefined;
  const liftBack = begin?.upWing && walk ? nearWing(all, "1", toPlan(walk[0])) : undefined;
  const route: Pt[] | null = walk
    ? [
        ...(liftBack ? [planToUnit(liftBack.x, liftBack.y)] : [walk[0]]),
        ...walk.slice(1, -1),
        ...(liftDown ? [planToUnit(liftDown.x, liftDown.y)] : [walk[walk.length - 1]]),
      ]
    : null;
  // Floor 1 first when there is a way in to show; otherwise straight to the place's floor.
  // Starting upstairs, the map opens where you are.
  // A block's upper floor (BLOCK_F_2) is about that floor: it opens there ("Way in: floor 1" goes back).
  const blockUpstairs = place !== null && /^BLOCK_[A-I]_\d$/.test(place.code);
  const beginFloor = begin?.floor && begin.floor !== "1" ? begin.floor : undefined;
  const startFloor: MapFloor = beginFloor ?? (route && !blockUpstairs ? "1" : (targetFloor ?? "1"));

  const [floor, setFloor] = useState<MapFloor>(startFloor);
  const [helper, setHelper] = useState<"toilet" | "stairs">();
  const [tapped, setTapped] = useState<MapPoint>();
  const [showBlocks, setShowBlocks] = useState(() => safeStorage.get(BLOCKS_KEY) !== "off");
  // Full screen (comfortable on phones) and the legend (folded on phones).
  const [full, setFull] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[aria-modal="true"]')) setFull(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);
  // A category's places (their pins), while no single place is picked.
  const markedPts = useMemo(() => {
    if (target || !marked || !points) return [];
    const ids = new Set<string>();
    for (const pl of marked) {
      for (const p of pl.point ? points.filter((x) => x.id === pl.point) : pointsFor(points, pl.code, pl.rooms)) ids.add(p.id);
    }
    return points.filter((p) => ids.has(p.id));
  }, [target, marked, points]);
  const markKey = markedPts.map((p) => p.id).join(",");
  const markedOn = (f: MapFloor) => markedPts.filter((p) => p.floor === f).length;
  // A new category: stay on this floor if it has some of them, else the floor with the most.
  useEffect(() => {
    if (!markKey) return;
    setFloor((f) => {
      const count = (x: MapFloor) => markedPts.filter((p) => p.floor === x).length;
      return count(f) > 0 ? f : FLOOR_ORDER.reduce((best, x) => (count(x) > count(best) ? x : best), f);
    });
  }, [markKey]);
  // A place opened by tapping its pin stays on the floor it was tapped on.
  const tappedOn = useRef<{ code: string; floor: MapFloor }>(undefined);
  // Another place or entrance (or the points just loaded): start on its floor again, nothing extra marked.
  useEffect(() => {
    const tap = tappedOn.current;
    setFloor(tap && tap.code === code ? tap.floor : startFloor);
    setHelper(undefined);
    setTapped(undefined);
  }, [code, startFloor, from, begin?.code]);
  // A step tapped under the map: its floor.
  useEffect(() => {
    if (!showFloor) return;
    setFloor(showFloor.floor);
    setTapped(undefined);
  }, [showFloor]);
  useEffect(() => onFloorChange?.(floor), [floor, onFloorChange]);
  // The route's ends on floor 1, named: where you start and where you go
  // (with an arrow when that end is an elevator).
  const nameOf = (x: ReturnType<typeof locate>) => (x.room ? x.room.code : x.place!.name[locale]);
  const startLabel = begin ? `${nameOf(begin)}${liftBack ? " ↓" : ""}` : t(ENTRANCE_KEY[from]);
  const endLabel = end ? `${nameOf(end)}${liftDown ? ` ↑ ${level ?? targetFloor}` : ""}` : undefined;
  const toggleBlocks = () =>
    setShowBlocks((v) => {
      safeStorage.set(BLOCKS_KEY, v ? "off" : "on");
      return !v;
    });

  const here = matches.filter((p) => p.floor === floor);
  const markedHere = markedPts.filter((p) => p.floor === floor);
  // Where "nearest" is measured from: the place's pin, else its block's letter.
  const blockSpot = block ? PLAN_BLOCKS.find((b) => b.block === block) : undefined;
  const anchor: { x: number; y: number } | undefined = here[0] ?? (target ? blockSpot : undefined);
  const help = helper && anchor ? nearest(all, floor, anchor, HELPERS.find((h) => h.id === helper)!.types) : undefined;
  // The elevator you take (floor 1) and come out of (the place's floor).
  const liftUp = upstairs && targetFloor && anchor && floor === targetFloor ? nearWing(all, targetFloor, anchor) : undefined;
  const lift = floor === "1" ? liftDown : liftUp;
  // …and the wing's stairs that go to every floor (at its far end).
  const stairs = lift ? nearWing(all, floor, lift, isFullStairs) : undefined;
  // On the room's floor: the walk from the elevator along the wing's corridor to it.
  const upPath = liftUp && here[0] && schemeBlock ? corridorPath(all, floor, schemeBlock, liftUp, here[0], level, room?.room) : null;
  // Where you start: its pin, and upstairs the walk from it to the wing's elevator.
  const beginHere = begin?.matches.filter((p) => p.floor === floor) ?? [];
  const liftStart = begin?.upWing && floor === begin.floor && beginHere[0] ? nearWing(all, floor, beginHere[0]) : undefined;
  const startPath = liftStart && begin?.schemeBlock
    ? corridorPath(all, floor, begin.schemeBlock, liftStart, beginHere[0], begin.level, begin.room?.room)
    : null;
  const walks = [startPath, upPath].filter((p): p is NonNullable<typeof p> => Boolean(p));
  // The elevator you start from: on your floor, and where you come out on floor 1.
  const startLift = floor === "1" ? liftBack : liftStart;
  // The blocks (tints, letters, clickable) on every floor when switched on;
  // floor 1 also always carries the route and entrances.
  const campus = showBlocks;
  const showRoute = floor === "1" && route;
  const layered = floor === "1" ? showBlocks || Boolean(route) : showBlocks;
  const upper = floor !== "1";
  // A block picked on an upper floor is that floor's place ("BLOCK_F_2", with
  // its own photos) and opens there (not back on floor 1, the way in).
  const pickHere = (picked: string) => {
    const blockLetter = upper ? /^BLOCK_([A-I])$/.exec(picked)?.[1] : undefined;
    const code = blockLetter ? blockOnFloor(blockLetter, floor) : picked;
    if (upper) tappedOn.current = { code, floor };
    onPick?.(code);
  };

  // What to frame: the place and its helper, else the whole route (with the pin), else the pin.
  let focus: { x: number; y: number; key: string; w?: number } | null = null;
  if (help && anchor) {
    focus = { x: (anchor.x + help.x) / 2, y: (anchor.y + help.y) / 2, w: dist(anchor, help) * 1.6 + 500, key: `${code}-${helper}-${help.id}` };
  } else if (showRoute) {
    const pts = [...route.map(toPlan), ...here, ...beginHere];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    focus = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.max(x2 - x1, (y2 - y1) * 2.4) * 1.25 + 300, key: `route-${code}-${begin?.code ?? from}` };
  } else if (walks.length > 0) {
    // The walks from the elevator to the room (and to where you start), with a little room around them.
    const xs = walks.flat().map((p) => p.x);
    const ys = walks.flat().map((p) => p.y);
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    focus = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.max(x2 - x1, (y2 - y1) * 1.6) + 700, key: `up-${code}-${begin?.code}-${floor}` };
  } else if (here[0] || beginHere[0]) {
    const pin = here[0] ?? beginHere[0];
    focus = { x: pin.x, y: pin.y, key: `${code}-${pin.id}-${pin.x}-${pin.y}` };
  } else if (markedHere.length > 0) {
    // Frame all of the category's pins on this floor.
    const xs = markedHere.map((p) => p.x);
    const ys = markedHere.map((p) => p.y);
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    focus = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.max(x2 - x1, (y2 - y1) * 2.4) * 1.2 + 500, key: `marked-${markKey}` };
  }
  const missing = target && points && matches.length === 0 && room;
  const otherFloor = targetFloor && targetFloor !== floor ? targetFloor : undefined;
  const right = route ? route[route.length - 1][0] >= route[0][0] : true;

  const body = (
    <section
      className={full ? "fixed inset-0 z-50 flex flex-col bg-background-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" : undefined}
      role={full ? "dialog" : undefined}
      aria-label={full ? t("mapsMapTitle") : undefined}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {full ? (
            <button
              type="button"
              onClick={() => setFull(false)}
              aria-label={t("close")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-primary hover:bg-background-2"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
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
                {markedOn(f) > 0 && floor !== f ? <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{markedOn(f)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={cn("relative", full && "min-h-0 flex-1")}>
        {(
          <FloorPlan
            floor={floor}
            points={all}
            highlight={here.map((p) => p.id)}
            secondary={[help?.id, lift?.id, stairs?.id, startLift?.id, ...beginHere.map((p) => p.id), ...markedHere.map((p) => p.id)].filter((id): id is string => Boolean(id))}
            dimOthers={markedHere.length > 0}
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
            layer={
              layered
                ? (k) => upper
                  ? <CampusLayer k={k} upper block={schemeBlock} onPick={onPick ? pickHere : undefined} />
                  : <CampusLayer k={k} blocks={showBlocks} block={schemeBlock} spot={spot} route={route} from={begin ? undefined : from} startLabel={startLabel} endLabel={endLabel} onPick={onPick} />
                : undefined
            }
            onPlanClick={
              campus && onPick
                ? (x, y) => {
                    // Upstairs only blocks: the halls, canteen and medical point are floor 1's.
                    const picked = upper ? placeAtPlan(...upperToFloor1(x, y), true) : placeAtPlan(x, y);
                    if (picked) pickHere(picked);
                  }
                : undefined
            }
            declutter
            paths={walks}
            loading={!points && !pointsFailed}
            controls={
              <button
                type="button"
                onClick={() => setFull((v) => !v)}
                aria-label={t(full ? "mapsExitFullscreen" : "mapsFullscreen")}
                title={t(full ? "mapsExitFullscreen" : "mapsFullscreen")}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-primary shadow-sm hover:bg-background-2"
              >
                {full ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
              </button>
            }
            // Taller on phones, so the plan isn't a thin strip; the whole screen in full screen.
            className={full ? "h-full" : "h-[60vh] min-h-[340px] max-h-[560px] md:h-[440px] md:min-h-0 md:max-h-none"}
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
        {target && (otherFloor || (route && floor !== "1") || (beginFloor && floor !== beginFloor)) ? (
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
                {t("mapsShowFloor").replace("{floor}", otherFloor === targetFloor && level ? level : otherFloor)}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {beginFloor && floor !== beginFloor ? (
              <button
                type="button"
                onClick={() => {
                  setFloor(beginFloor);
                  setTapped(undefined);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-primary shadow-md hover:bg-background-2"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("mapsShowStart").replace("{floor}", begin?.level ?? beginFloor)}
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
                {t(begin ? "mapsRouteFloor1" : "mapsBackToRoute")}
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
      {markedPts.length > 0 ? (
        <p className="mt-2 text-xs text-label">
          {t("mapsMarkedHere").replace("{n}", String(markedHere.length)).replace("{floor}", floor)}
          {markedHere.length < markedPts.length ? ` ${t("mapsMarkedOther")}` : ""}
        </p>
      ) : null}
      {helper && anchor && !help ? <p className="mt-2 text-xs text-label">{t("mapsNoneOnFloor")}</p> : null}
      {liftStart && floor !== "1" && !help ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-label">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TYPE_META.elevator.color }} />
          {oneWing ? t("mapsLiftHere").replace("{floor}", level ?? targetFloor ?? "") : t("mapsLiftDownHere")}
        </p>
      ) : null}
      {lift && !help && lift.id !== liftStart?.id ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-label">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TYPE_META.elevator.color }} />
          {t(floor === "1" ? (stairs ? "mapsLiftStairsHere" : "mapsLiftHere") : stairs ? "mapsLiftStairsOut" : "mapsLiftOut").replace("{floor}", level ?? targetFloor ?? "")}
          {floor !== "1" && upPath ? ` ${t("mapsWalkLine")}` : ""}
        </p>
      ) : null}
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

      {/* The legend folds into a button on phones. */}
      <button
        type="button"
        onClick={() => setLegendOpen((v) => !v)}
        aria-expanded={legendOpen}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-label md:hidden"
      >
        {t("mapsLegend")}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", legendOpen && "rotate-180")} />
      </button>
      <p className={cn("mt-2 flex-wrap gap-x-3 gap-y-1 text-[11px] text-label", legendOpen ? "flex" : "hidden md:flex")}>
        {layered && !upper ? (
          <>
            {route ? <Dot className="bg-accent" label={t("mapsLegendRoute")} /> : null}
            <Dot className="bg-red-600" label={t("mapsLegendEntrance")} />
            {campus ? <Dot className="bg-amber-500" label={t("mapsHalls")} /> : null}
          </>
        ) : null}
        {/* Entrances are already in the legend when the campus layer draws them. */}
        {LEGEND.filter((type) => !(layered && !upper && type === "entrance")).map((type) => (
          <span key={type} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_META[type].color }} />
            {t(TYPE_META[type].key)}
          </span>
        ))}
        <span>· {t("mapsFloorPlanHint")}</span>
      </p>
      {campus && !upper && !full ? <p className="mt-1 hidden text-[11px] text-label md:block">{t("mapsSchemeNote")}</p> : null}
    </section>
  );
  // Full screen goes on <body>: the page area is its own layer and would trap it.
  return full ? (
    <>
      <div className="h-[60vh] min-h-[340px] max-h-[560px] md:h-[440px]" aria-hidden />
      {createPortal(body, document.body)}
    </>
  ) : (
    body
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
