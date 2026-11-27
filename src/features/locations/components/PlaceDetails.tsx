import { Mascot } from "@/shared/ui/Mascot";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { getErrorStatus } from "@/shared/api/client";
import { Button } from "@/shared/ui/Button";
import { copyText } from "@/shared/lib/clipboard";
import { Armchair, ArrowDown, ArrowUp, BookOpen, Building2, Check, CheckCircle2, Clock, ConciergeBell, Crosshair, DoorOpen, Flag, Footprints, Info, Lightbulb, Link2, MapPin, Presentation, Rotate3d, UtensilsCrossed } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useReportLocation, type MapSpot } from "../api";
import { toursFor, type TourView } from "../tours";
import { FLOOR_ORDER, floorOfRoom, levelOf, pointsFor, useMapPoints, type MapFloor } from "../mapPoints";
import { FloorPlan } from "./FloorPlan";
import { PlacePhotos } from "./PlacePhotos";
import { TourViewer } from "./TourViewer";
import { AddPhotoButton, checkPhotos, PhotoThumb } from "@/features/forum/components/Photos";
import { uploadReportPhoto } from "../photos";
import { blockOnFloor, blockPlace, floorsOfBlock, type Entrance, type Place, type PlaceKind, type RoomCode, type SchemeBlock } from "../places";

export const KIND_ICON: Record<PlaceKind, typeof Building2> = {
  block: Building2, food: UtensilsCrossed, study: BookOpen, service: ConciergeBell, rest: Armchair, entrance: DoorOpen, tour: Rotate3d, room: Presentation,
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

/** One step of the way; `floor` = the plan that shows it (tapping the step opens it). */
interface Step { icon: ReactNode; title: string; note?: string; done?: boolean; floor: MapFloor; level?: string }

/** Where the route starts when it isn't an entrance: a room or place. */
interface StartInfo { name: string; block?: string; floor?: number; level?: string; spot: boolean }

/** A floor number as a plan (floors above 4 don't exist; none = floor 1). */
const planOf = (floor?: number): MapFloor => (floor === 2 ? "2" : floor === 3 ? "3" : floor && floor >= 4 ? "4" : "1");

function steps(t: (k: TranslationKey) => string, block: string | undefined, floor: number | undefined, from: Entrance, last: string, spotName?: string, level?: string, start?: StartInfo): Step[] {
  const startWing = Boolean(start?.block && WINGS.has(start.block));
  const startUp = Boolean(start?.floor && start.floor > 1);
  const startPlan = planOf(start?.floor);
  const endPlan = planOf(floor);
  const out: Step[] = [
    start
      ? { icon: <MapPin className="h-4 w-4" />, title: fill(t("mapsStepStart"), { name: start.name }), floor: startPlan, level: start.level }
      : { icon: <DoorOpen className="h-4 w-4" />, title: fill(t("mapsStepEnter"), { e: from }), floor: "1" },
  ];
  // Both upstairs in one wing: only the elevator (or the corridor, on one floor).
  if (start && startUp && startWing && start.block === block && floor && floor > 1) {
    out.push(
      start.level === level
        ? { icon: <Footprints className="h-4 w-4" />, title: t("mapsStepWingCorridor"), floor: startPlan }
        : { icon: <ArrowUp className="h-4 w-4" />, title: fill(t("mapsStepLiftTo"), { floor: level ?? floor }), note: t("mapsStairsEnd"), floor: startPlan },
    );
    out.push({ icon: <CheckCircle2 className="h-4 w-4" />, title: last, done: true, floor: endPlan, level });
    return out;
  }
  if (start && startUp) {
    out.push({ icon: <ArrowDown className="h-4 w-4" />, title: t(startWing ? "mapsStepLiftDown" : "mapsStepStairsDown"), floor: startPlan });
  }
  // Starting in the same block (on floor 1, or after coming down): no walk to it.
  const sameBlock = Boolean(start && !start.spot && !spotName && start.block === block);
  if (sameBlock) {
    // Already there.
  } else if (spotName) {
    out.push({ icon: <Footprints className="h-4 w-4" />, title: fill(t("mapsStepCorridorTo"), { name: spotName }), note: t("mapsStepCorridorNote"), floor: "1" });
  } else if (!block) {
    // Nothing to walk: the place is outside the main building.
  } else if (block === "C" && from === "C" && !start) {
    // Entrance C is in block C: nothing more to walk.
  } else if (WINGS.has(block)) {
    out.push({ icon: <Footprints className="h-4 w-4" />, title: fill(t("mapsStepCorridor"), { block }), note: t("mapsStepCorridorNote"), floor: "1" });
  } else if (SCHEME_BLOCKS.has(block)) {
    out.push({ icon: <Footprints className="h-4 w-4" />, title: fill(t("mapsStepToBlock"), { block }), floor: "1" });
  } else {
    out.push({ icon: <Info className="h-4 w-4" />, title: fill(t("mapsStepUnknownBlock"), { block }), floor: "1" });
  }
  if (floor && floor > 1) {
    // The wings are split-level: 3A = the right part, 3B = the left part, 4 = the right part only.
    // Which stairs get there: the wing's end stairs go everywhere; "Stairs 2-3A-3B"
    // start on floor 2 near the wing's entrance, "Stairs 3B-4" on floor 3B.
    const wing = block && WINGS.has(block);
    const notes = !wing
      ? []
      : [
          level === "3A" ? fill(t("mapsStep3A"), { block: block! })
          : level === "3B" ? fill(t("mapsStep3B"), { block: block! })
          : level === "4" ? t("mapsStepSplit4")
          : "",
          t("mapsStairsEnd"),
          level === "3A" || level === "3B" ? t("mapsStairs23") : level === "4" ? t("mapsStairs34") : "",
        ].filter(Boolean);
    const note = notes.length ? notes.join(" ") : undefined;
    out.push({
      icon: <ArrowUp className="h-4 w-4" />,
      title: fill(t(wing ? "mapsStepLift" : "mapsStepStairs"), { floor: level ?? floor }),
      note,
      // The elevator is taken on floor 1 (marked there).
      floor: "1",
    });
  }
  out.push({ icon: <CheckCircle2 className="h-4 w-4" />, title: last, done: true, floor: endPlan, level });
  return out;
}

export function PlaceDetails({ target, from, start, startRoutable, mapFloor, onShowFloor, onStartHere, onPlace }: {
  target: Place | RoomCode;
  from: Entrance;
  /** A room or place the route starts from instead of the entrance (chosen above the map). */
  start?: Place | RoomCode;
  /** The start is on the scheme (else the route starts from the entrance). */
  startRoutable?: boolean;
  /** The floor the map shows now: its steps are highlighted. */
  mapFloor?: MapFloor;
  /** A step tapped: show its floor on the map. */
  onShowFloor?: (floor: MapFloor) => void;
  /** "Start from here": this place becomes the route's start (none when it already is). */
  onStartHere?: () => void;
  /** Open another place (a block's floor switch: "BLOCK_F" → "BLOCK_F_2"). */
  onPlace?: (code: string) => void;
}) {
  const { t, locale } = useLocale();
  const room = "room" in target ? target : null;
  const place = room ? null : (target as Place);
  const block = target.block;
  const faculty = room ? blockPlace(room.block) : null;

  const title = room ? fill(t("mapsRoomTitle"), { code: room.code }) : place!.name[locale];
  // A block (any of its floors): the floor switch.
  const blockFloors = onPlace && place?.kind === "block" && block && /^BLOCK_[A-I](_\d)?$/.test(place.code) ? floorsOfBlock(block) : undefined;
  const blockFloor = place?.floor ? String(place.floor) : "1";
  // "3A" / "3B" for a room on floor 3 (the wing's right / left part).
  const level = room ? levelOf(room.floor, room.room) : place?.floor ? String(place.floor) : undefined;
  // 3D tour views: a room by its code, a map point by its name, a place by its code.
  // …and the views admins attached to its points in the map editor.
  const { data: points } = useMapPoints();
  const own = !points ? [] : place?.point ? points.filter((p) => p.id === place.point) : pointsFor(points, room ? room.code : place!.code, place?.rooms ?? []);
  const tours = [
    ...(room ? toursFor(room.code) : place!.point ? toursFor(place!.name.en) : toursFor(place!.code)),
    ...own.flatMap((p) =>
      p.tours.map((x): TourView => {
        const label = x.label || p.name || p.code || title;
        return { url: x.url, label: { en: label, kz: label, ru: label } };
      }),
    ),
  ].filter((v, i, list) => list.findIndex((w) => w.url === v.url) === i);
  // The 3D tour view open over the page, if any (closed when the place changes).
  const [tourAt, setTourAt] = useState<number>();
  const closeTour = useCallback(() => setTourAt(undefined), []);
  const targetCode = room ? room.code : place!.code;
  useEffect(() => setTourAt(undefined), [targetCode]);
  const spot = place?.spot;
  const startInfo: StartInfo | undefined = start && startRoutable && start.code !== targetCode
    ? {
        name: "room" in start ? start.code : start.name[locale],
        block: start.block,
        floor: start.floor,
        level: "room" in start ? levelOf(start.floor, start.room) : start.floor ? String(start.floor) : undefined,
        spot: !("room" in start) && Boolean(start.spot),
      }
    : undefined;
  const route =
    spot || (block && (room || place?.kind === "block" || place?.floor))
      ? steps(
          t, block, room?.floor ?? place?.floor, from,
          room ? fill(t("mapsStepRoom"), { room: room.room }) : fill(t("mapsStepHere"), { name: place!.name[locale] }),
          spot ? place!.name[locale] : undefined,
          level,
          startInfo,
        )
      : null;
  const floorsInRoute = route ? new Set(route.map((s) => s.floor)).size : 0;

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
            {level !== undefined && !blockFloors && <Chip>{fill(t("mapsFloor"), { floor: level })}</Chip>}
            {room && <Chip>{fill(t("mapsRoom"), { room: room.room })}</Chip>}
            {faculty && <Chip tone="sky">{faculty.where[locale]}</Chip>}
          </div>
          {/* A block's floors: each is its own place with its own photos (BLOCK_F, BLOCK_F_2…). */}
          {blockFloors ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="text-label">{t("mapEditorFloor")}</span>
              <div className="inline-flex rounded-xl border border-border bg-surface p-0.5" role="group" aria-label={t("mapEditorFloor")}>
                {blockFloors.map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={f === blockFloor}
                    aria-label={fill(t("mapsFloor"), { floor: f })}
                    onClick={() => f !== blockFloor && onPlace?.(blockOnFloor(block!, f))}
                    className={cn("min-w-8 rounded-lg px-2.5 py-1.5 transition-colors", f === blockFloor ? "bg-brand text-white" : "text-label hover:text-primary")}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <CopyLink path={room ? `/navigation?q=${encodeURIComponent(room.code)}` : `/navigation?place=${encodeURIComponent(place!.code)}`} />
            {onStartHere ? (
              <button
                type="button"
                onClick={onStartHere}
                className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-brand hover:bg-background-2 dark:text-primary"
              >
                <MapPin className="h-3.5 w-3.5" />
                {t("mapsStartHere")}
              </button>
            ) : null}
          </div>
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
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-label">{t("mapsHowToGet")}</h3>
          {/* Steps on more than one floor: tapping one shows its floor on the map; the floor on screen is highlighted. */}
          <ol className="relative space-y-2 pl-10">
            <span className="absolute bottom-3 left-[15px] top-3 w-px bg-border" aria-hidden />
            {route.map((s, i) => {
              const here = floorsInRoute > 1 && s.floor === mapFloor;
              const body = (
                <>
                  <p className="text-sm font-semibold text-primary">{s.title}</p>
                  {s.note && <p className="text-xs text-label">{s.note}</p>}
                </>
              );
              return (
                <li key={i} className="relative">
                  <span className={cn(
                    "absolute -left-10 top-1 flex h-8 w-8 items-center justify-center rounded-full",
                    s.done ? "bg-green-50 text-green-700" : here ? "bg-brand text-white" : "bg-background-2 text-primary",
                  )}>
                    {s.icon}
                  </span>
                  {floorsInRoute > 1 && onShowFloor ? (
                    <button
                      type="button"
                      onClick={() => onShowFloor(s.floor)}
                      aria-current={here ? "step" : undefined}
                      className={cn(
                        "flex w-full items-start justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors",
                        here ? "bg-background-2" : "hover:bg-background-2",
                      )}
                    >
                      <span className="min-w-0">{body}</span>
                      <span className={cn(
                        "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        here ? "bg-brand text-white" : "border border-border text-label",
                      )}>
                        {fill(t("mapsStepFloor"), { floor: s.level ?? s.floor })}
                      </span>
                    </button>
                  ) : (
                    <div className="px-2.5 py-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* key: a new place starts with a fresh "add a photo" */}
      <PlacePhotos key={`photos-${room ? room.code : place!.code}`} target={target} />

      {tours.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setTourAt(0)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            <Rotate3d className="h-4 w-4" />
            {t("mapsOpenTour")}
          </button>
          {tours.length > 1 ? (
            <div className="mt-2.5">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-label">{t("mapsTourMore")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {tours.slice(1).map((view, k) => (
                  <li key={view.url}>
                    <button
                      type="button"
                      onClick={() => setTourAt(k + 1)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-primary hover:bg-background-2"
                    >
                      <Rotate3d className="h-3 w-3 text-label" />
                      {view.label[locale]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {tourAt !== undefined ? <TourViewer title={title} views={tours} start={tourAt} onClose={closeTour} /> : null}
        </div>
      )}

      {/* key: a new place starts with a fresh form */}
      <ReportMistake key={`report-${room ? room.code : place!.code}`} target={target} placeCode={room ? room.code : place!.code} placeName={title} from={from} />
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
      className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-brand hover:bg-background-2 dark:text-primary"
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
  const [floor, setFloor] = useState<MapFloor>((room ? floorOfRoom(room.floor, room.room) : undefined) ?? matches[0]?.floor ?? "1");
  const tooShort = text.trim().length < 5;
  // An optional photo, uploaded right after the report is created.
  const [photo, setPhoto] = useState<File>();
  const [photoPreview, setPhotoPreview] = useState<string>();
  const [photoProblem, setPhotoProblem] = useState<TranslationKey>();
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ photoFailed: boolean }>();
  useEffect(() => {
    if (!photo) return setPhotoPreview(undefined);
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const send = async () => {
    setSending(true);
    try {
      const sent = await report.mutateAsync({ placeCode, placeName, entrance: from, text: text.trim(), suggested: spot });
      let photoFailed = false;
      if (photo) {
        try {
          await uploadReportPhoto(sent.id, photo);
        } catch {
          photoFailed = true;
        }
      }
      setDone({ photoFailed });
    } catch {
      // Shown from report.error below.
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-1 rounded-xl bg-green-50 px-3 py-2.5 text-sm text-green-700">
        <p className="flex items-center gap-3">
          <Mascot mood="happy" size="sm" />
          {t("mapsReportThanks")}
        </p>
        {done.photoFailed ? <p className="text-error">{t("mapsReportPhotoFailed")}</p> : null}
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
        if (!tooShort && !sending) void send();
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
        className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary outline-none placeholder:text-placeholder focus:border-brand"
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
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-primary">{t("mapsReportPhoto")}</p>
        <div className="flex items-center gap-3">
          {photo && photoPreview ? (
            <PhotoThumb src={photoPreview} label={photo.name} onRemove={() => setPhoto(undefined)} />
          ) : (
            <AddPhotoButton
              onFiles={(files) => {
                const { ok, problem } = checkPhotos(files, 1);
                // Several files picked: the first one is taken.
                setPhotoProblem(problem === "photoTooMany" ? undefined : problem);
                if (ok[0]) setPhoto(ok[0]);
              }}
            />
          )}
          <p className={cn("text-xs", photoProblem ? "text-error" : "text-label")}>
            {photoProblem ? t(photoProblem) : t("mapsReportPhotoHint")}
          </p>
        </div>
      </div>
      {status === 409 ? <p className="text-sm text-error">{t("mapsReportAlready")}</p> : report.isError ? <p className="text-sm text-error">{t("mapsReportFailed")}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={tooShort || sending}>{t("mapsReportSend")}</Button>
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
