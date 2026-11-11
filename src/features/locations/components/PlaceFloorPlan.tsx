// The floor plan in a place's card on the Maps page: the exact room or service
// pinned on its floor (points from the server, kept right by admins in the map
// editor), with toilets, stairs and entrances around it.
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { useEffect, useState } from "react";
import { FLOOR_ORDER, TYPE_META, floorOfRoom, pointsFor, useMapPoints, type MapFloor, type PointType } from "../mapPoints";
import type { Place, RoomCode } from "../places";
import { FloorPlan } from "./FloorPlan";

const LEGEND: PointType[] = ["room", "toilet", "stairs", "entrance", "canteen", "medical"];

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
  // Another place: start on its floor again.
  useEffect(() => setFloor(startFloor), [code, startFloor]);

  if (!points || !floor) return null;
  const here = matches.filter((p) => p.floor === floor);
  const focus = here[0]
    ? { x: here[0].x, y: here[0].y, key: `${code}-${here[0].id}-${here[0].x}-${here[0].y}` }
    : null;
  const missing = matches.length === 0 && room;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-label">{t("mapsFloorPlan")}</h3>
        <div className="inline-flex rounded-xl border border-border bg-surface p-0.5 text-xs font-semibold" role="group" aria-label={t("mapsFloorPlan")}>
          {FLOOR_ORDER.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFloor(f)}
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
      <FloorPlan
        floor={floor}
        points={points}
        highlight={here.map((p) => p.id)}
        block={here.length === 0 ? block : undefined}
        focus={focus}
        className="h-[280px] md:h-[380px]"
      />
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
