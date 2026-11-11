import { Mascot } from "@/shared/ui/Mascot";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { getErrorStatus } from "@/shared/api/client";
import { Button } from "@/shared/ui/Button";
import { copyText } from "@/shared/lib/clipboard";
import { Armchair, ArrowUp, BookOpen, Building2, Check, CheckCircle2, Clock, ConciergeBell, Crosshair, DoorOpen, ExternalLink, Flag, Footprints, Info, Lightbulb, Link2, UtensilsCrossed } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useReportLocation, type MapSpot } from "../api";
import { FLOOR_ORDER, floorOfRoom, pointsFor, useMapPoints, type MapFloor } from "../mapPoints";
import { FloorPlan } from "./FloorPlan";
import { PlaceFloorPlan } from "./PlaceFloorPlan";
import { ENTRANCE_KEY, ENTRANCE_ORDER, TOUR_URL, blockPlace, type Entrance, type Place, type PlaceKind, type RoomCode, type SchemeBlock } from "../places";

export const KIND_ICON: Record<PlaceKind, typeof Building2> = {
  block: Building2, food: UtensilsCrossed, study: BookOpen, service: ConciergeBell, rest: Armchair, entrance: DoorOpen,
};

const SCHEME_BLOCKS = new Set<string>(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
const WINGS = new Set<string>(["D", "E", "F", "G", "H", "I"]);

/** The block drawn on the scheme for a room or place, if any. */
export function schemeBlockOf(target: Place | RoomCode): SchemeBlock | undefined {
  const b = target.block;
  return b && SCHEME_BLOCKS.has(b) ? (b as SchemeBlock) : undefined;
}

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

interface Step { icon: ReactNode; title: string; note?: string; done?: boolean }

function steps(t: (k: TranslationKey) => string, block: string | undefined, floor: number | undefined, from: Entrance, last: string, spotName?: string): Step[] {
  const out: Step[] = [
    { icon: <DoorOpen className="h-4 w-4" />, title: fill(t("mapsStepEnter"), { e: from }) },
  ];
  if (spotName) {
    out.push({ icon: <Footprints className="h-4 w-4" />, title: fill(t("mapsStepCorridorTo"), { name: spotName }), note: t("mapsStepCorridorNote") });
  } else if (!block) {
    // Nothing to walk: the place is outside the main building.
  } else if (block === "C" && from === "C") {
    // Entrance C is in block C: nothing more to walk.
  } else if (WINGS.has(block)) {
    out.push({ icon: <Footprints className="h-4 w-4" />, title: fill(t("mapsStepCorridor"), { block }), note: t("mapsStepCorridorNote") });
  } else if (SCHEME_BLOCKS.has(block)) {
    out.push({ icon: <Footprints className="h-4 w-4" />, title: fill(t("mapsStepToBlock"), { block }) });
  } else {
    out.push({ icon: <Info className="h-4 w-4" />, title: fill(t("mapsStepUnknownBlock"), { block }) });
  }
  if (floor && floor > 1) {
    out.push({ icon: <ArrowUp className="h-4 w-4" />, title: fill(t("mapsStepStairs"), { floor }) });
  }
  out.push({ icon: <CheckCircle2 className="h-4 w-4" />, title: last, done: true });
  return out;
}

export function PlaceDetails({ target, from, onFrom }: { target: Place | RoomCode; from: Entrance; onFrom: (e: Entrance) => void }) {
  const { t, locale } = useLocale();
  const room = "room" in target ? target : null;
  const place = room ? null : (target as Place);
  const block = target.block;
  const faculty = room ? blockPlace(room.block) : null;

  const title = room ? fill(t("mapsRoomTitle"), { code: room.code }) : place!.name[locale];
  const tour = place?.tour;
  const spot = place?.spot;
  const route =
    spot || (block && (room || place?.kind === "block" || place?.floor))
      ? steps(
          t, block, room?.floor ?? place?.floor, from,
          room ? fill(t("mapsStepRoom"), { room: room.room }) : fill(t("mapsStepHere"), { name: place!.name[locale] }),
          spot ? place!.name[locale] : undefined,
        )
      : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="flex h-16 min-w-16 shrink-0 items-center justify-center rounded-2xl bg-brand px-3 text-lg font-bold text-white">
          {room ? room.code : place!.kind === "block" && block ? block : <PlaceIcon kind={place!.kind} />}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-primary">{title}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-medium">
            {block && <Chip>{fill(t("mapsBlock"), { block })}</Chip>}
            {(room?.floor ?? place?.floor) !== undefined && <Chip>{fill(t("mapsFloor"), { floor: room?.floor ?? place!.floor! })}</Chip>}
            {room && <Chip>{fill(t("mapsRoom"), { room: room.room })}</Chip>}
            {faculty && <Chip tone="sky">{faculty.where[locale]}</Chip>}
          </div>
          <CopyLink path={room ? `/navigation?q=${encodeURIComponent(room.code)}` : `/navigation?place=${encodeURIComponent(place!.code)}`} />
        </div>
      </div>

      {room ? (
        <p className="flex items-start gap-2 rounded-xl bg-background-2 px-3 py-2.5 text-sm text-primary">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          {fill(t("mapsDecode"), { block: room.block, floor: room.floor, room: room.room })}
        </p>
      ) : (
        <div className="space-y-1.5 text-sm text-primary">
          <p>{place!.where[locale]}</p>
          {place!.hours && (
            <p className="flex items-center gap-2 text-label"><Clock className="h-4 w-4" />{place!.hours}</p>
          )}
          {place!.contact && <p className="text-label">{place!.contact}</p>}
        </div>
      )}

      {route && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-label">{t("mapsHowToGet")}</h3>
            <div className="inline-flex rounded-xl border border-border bg-surface p-0.5 text-xs font-semibold" role="group" aria-label={t("mapsFrom")}>
              {ENTRANCE_ORDER.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onFrom(e)}
                  aria-pressed={from === e}
                  className={cn("rounded-lg px-3 py-1.5 transition-colors", from === e ? "bg-brand text-white" : "text-label hover:text-primary")}
                >
                  {t(ENTRANCE_KEY[e])}
                </button>
              ))}
            </div>
          </div>
          <ol className="relative space-y-4 pl-10">
            <span className="absolute bottom-3 left-[15px] top-3 w-px bg-border" aria-hidden />
            {route.map((s, i) => (
              <li key={i} className="relative">
                <span className={cn(
                  "absolute -left-10 top-0 flex h-8 w-8 items-center justify-center rounded-full",
                  s.done ? "bg-green-50 text-green-700" : "bg-background-2 text-primary",
                )}>
                  {s.icon}
                </span>
                <p className="pt-1 text-sm font-semibold text-primary">{s.title}</p>
                {s.note && <p className="text-xs text-label">{s.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {tour !== undefined && (
        <div>
          <a
            href={`${TOUR_URL}${tour}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            <ExternalLink className="h-4 w-4" />
            {t("mapsOpenTour")}
          </a>
          <p className="mt-1.5 text-xs text-label">{t("mapsTourHint")}</p>
        </div>
      )}

      <PlaceFloorPlan target={target} />

      {/* key: a new place starts with a fresh form */}
      <ReportMistake key={room ? room.code : place!.code} target={target} placeCode={room ? room.code : place!.code} placeName={title} from={from} />
    </div>
  );
}

/** "Copy link": a link straight to this room or place, to send to a friend. */
function CopyLink({ path }: { path: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={async () => setCopied(await copyText(`${window.location.origin}${path}`))}
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-brand hover:bg-background-2 dark:text-primary"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? t("mapsLinkCopied") : t("mapsCopyLink")}
    </button>
  );
}

/**
 * "Report a mistake": a student says the route or the position is wrong, and
 * may tap the right spot on the floor plan ("it's actually here"); admins see
 * it in the admin panel and apply it in one click.
 */
function ReportMistake({ target, placeCode, placeName, from }: { target: Place | RoomCode; placeCode: string; placeName: string; from: Entrance }) {
  const { t } = useLocale();
  const report = useReportLocation();
  const { data: points } = useMapPoints();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(false);
  const [spot, setSpot] = useState<MapSpot>();
  const room = "room" in target ? target : null;
  const asPlace = room ? null : (target as Place);
  const matches = !points ? [] : asPlace?.point ? points.filter((p) => p.id === asPlace.point) : pointsFor(points, placeCode, asPlace?.rooms ?? []);
  const [floor, setFloor] = useState<MapFloor>((room ? floorOfRoom(room.floor) : undefined) ?? matches[0]?.floor ?? "1");
  const tooShort = text.trim().length < 5;

  if (report.isSuccess) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-green-50 px-3 py-2.5 text-sm text-green-700">
        <Mascot mood="happy" size="sm" />
        {t("mapsReportThanks")}
      </div>
    );
  }
  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Flag className="h-4 w-4" />
        {t("mapsReportMistake")}
      </Button>
    );
  }
  const status = report.isError ? getErrorStatus(report.error) : undefined;
  return (
    <form
      className="space-y-2 rounded-2xl border border-border bg-background-2/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!tooShort) report.mutate({ placeCode, placeName, entrance: from, text: text.trim(), suggested: spot });
      }}
    >
      <label htmlFor="map-report" className="block text-sm font-semibold text-primary">{t("mapsReportTitle")}</label>
      <textarea
        id="map-report"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        rows={3}
        autoFocus
        placeholder={t("mapsReportPlaceholder")}
        className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary outline-none placeholder:text-label/70 focus:border-brand"
      />
      {points ? (
        picking ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-primary">{spot ? t("mapsSpotPicked") : t("mapsSpotTap")}</p>
              <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs font-semibold" role="group" aria-label={t("mapEditorFloor")}>
                {FLOOR_ORDER.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={floor === f}
                    onClick={() => setFloor(f)}
                    className={cn("rounded-md px-2 py-1", floor === f ? "bg-brand text-white" : "text-label hover:text-primary")}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <FloorPlan
              floor={floor}
              points={points}
              highlight={matches.filter((p) => p.floor === floor).map((p) => p.id)}
              ghost={spot && spot.floor === floor ? { x: spot.x, y: spot.y } : null}
              focus={matches.find((p) => p.floor === floor) ? { x: matches.find((p) => p.floor === floor)!.x, y: matches.find((p) => p.floor === floor)!.y, key: `report-${floor}` } : null}
              picking
              onPlanClick={(x, y) => setSpot({ floor, x, y })}
              className="h-[240px] md:h-[300px]"
            />
            {spot ? (
              <button type="button" onClick={() => setSpot(undefined)} className="text-xs font-semibold text-label hover:text-primary">
                {t("mapsSpotClear")}
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline dark:text-primary"
          >
            <Crosshair className="h-3.5 w-3.5" />
            {t("mapsSpotOffer")}
          </button>
        )
      ) : null}
      {status === 409 ? <p className="text-sm text-error">{t("mapsReportAlready")}</p> : report.isError ? <p className="text-sm text-error">{t("mapsReportFailed")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={tooShort || report.isPending}>{t("mapsReportSend")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
      </div>
    </form>
  );
}

function PlaceIcon({ kind }: { kind: PlaceKind }) {
  const Icon = KIND_ICON[kind];
  return <Icon className="h-7 w-7" />;
}

function Chip({ children, tone }: { children: ReactNode; tone?: "sky" }) {
  return (
    <span className={cn("rounded-lg px-2 py-1", tone === "sky" ? "bg-sky-50 text-sky-700" : "bg-background-2 text-primary")}>
      {children}
    </span>
  );
}
