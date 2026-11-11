// "Exact spot" in a place's card on the Maps page: the room or service pinned
// on its floor (points from the server, kept right by admins in the map
// editor), with toilets, stairs and entrances around it. Tap any pin to see
// what it is; "Nearest toilet / stairs" marks the closest one on that floor.
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Footprints, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  FLOOR_ORDER, PLAN_BLOCKS, TYPE_META, floorOfRoom, pointLabel, pointsFor, useMapPoints,
  type MapFloor, type MapPoint, type PointType,
} from "../mapPoints";
import type { Place, RoomCode } from "../places";
import { FloorPlan } from "./FloorPlan";

const LEGEND: PointType[] = ["room", "toilet", "stairs", "entrance", "canteen", "medical"];
/** The helpers a student asks for, and which point types count. */
const HELPERS: { id: "toilet" | "stairs"; types: PointType[]; key: "mapsNearestToilet" | "mapsNearestStairs" }[] = [
  { id: "toilet", types: ["toilet"], key: "mapsNearestToilet" },
  { id: "stairs", types: ["stairs", "elevator"], key: "mapsNearestStairs" },
];

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The closest point of these types on the floor to `from`. */
function nearest(points: MapPoint[], floor: MapFloor, from: { x: number; y: number }, types: PointType[]) {
  let best: MapPoint | undefined;
  for (const p of points) {
    if (p.floor !== floor || !types.includes(p.type)) continue;
    if (!best || dist(p, from) < dist(best, from)) best = p;
  }
  return best;
}

export function PlaceFloorPlan({ target }: { target: Place | RoomCode }) {
  const { t } = useLocale();
  const { data: points } = useMapPoints();
  const room = "room" in target ? target : null;
  const place = room ? null : (target as Place);
  const code = room ? room.code : place!.code;
  const matches = points ? pointsFor(points, code, place?.rooms) : [];
  const block = target.block;
  const startFloor: MapFloor | undefined =
    (room ? floorOfRoom(room.floor) : undefined) ?? matches[0]?.floor ?? (place?.kind === "block" ? "1" : undefined);
  const [floor, setFloor] = useState<MapFloor | undefined>(startFloor);
  const [helper, setHelper] = useState<"toilet" | "stairs">();
  const [tapped, setTapped] = useState<MapPoint>();
  // Another place: start on its floor again, with nothing extra marked.
  useEffect(() => {
    setFloor(startFloor);
    setHelper(undefined);
    setTapped(undefined);
  }, [code, startFloor]);

  if (!points || !floor) return null;
  const here = matches.filter((p) => p.floor === floor);
  // Where "nearest" is measured from: the place's pin, else its block's letter.
  const blockSpot = block ? PLAN_BLOCKS.find((b) => b.block === block) : undefined;
  const anchor: { x: number; y: number } | undefined = here[0] ?? blockSpot;
  const help = helper && anchor ? nearest(points, floor, anchor, HELPERS.find((h) => h.id === helper)!.types) : undefined;

  let focus: { x: number; y: number; key: string; w?: number } | null = here[0]
    ? { x: here[0].x, y: here[0].y, key: `${code}-${here[0].id}-${here[0].x}-${here[0].y}` }
    : null;
  if (help && anchor) {
    // Both the place and the helper in view.
    focus = { x: (anchor.x + help.x) / 2, y: (anchor.y + help.y) / 2, w: dist(anchor, help) * 1.6 + 500, key: `${code}-${helper}-${help.id}` };
  }
  const missing = matches.length === 0 && room;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-label">{t("mapsFloorPlan").replace("{floor}", floor)}</h3>
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
              className={cn(
                "rounded-lg px-2.5 py-1.5 transition-colors",
                floor === f ? "bg-brand text-white" : "text-label hover:text-primary",
                matches.some((p) => p.floor === f) && floor !== f && "text-accent",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {anchor ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {HELPERS.map((h) => (
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
        </div>
      ) : null}
      <FloorPlan
        floor={floor}
        points={points}
        highlight={here.map((p) => p.id)}
        secondary={help ? [help.id] : []}
        block={here.length === 0 ? block : undefined}
        focus={focus}
        onPointClick={setTapped}
        className="h-[280px] md:h-[380px]"
      />
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
        <p className="mt-2 text-xs text-label">{t("mapsNotOnPlan").replace("{code}", code).replace("{block}", block ?? "")}</p>
      ) : null}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-label">
        {LEGEND.map((type) => (
          <span key={type} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_META[type].color }} />
            {t(TYPE_META[type].key)}
          </span>
        ))}
        <span>· {t("mapsFloorPlanHint")}</span>
      </p>
    </section>
  );
}
