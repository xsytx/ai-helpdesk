import { Mascot } from "@/shared/ui/Mascot";
import { CampusMap } from "@/features/locations/components/CampusMap";
import { StartField } from "@/features/locations/components/StartField";
import { KIND_ICON, PlaceDetails, schemeBlockOf } from "@/features/locations/components/PlaceDetails";
import { legFromHall } from "@/features/locations/campusShapes";
import { BLOCK_FLOORS, PLACES, parseRoomCode, placeForRoom, searchPlaces, type Entrance, type Place, type PlaceKind, type RoomCode } from "@/features/locations/places";
import { levelOf, useMapPoints, type MapFloor, type MapPoint } from "@/features/locations/mapPoints";
import { POINT_PLACE_PREFIX, pointPlaces } from "@/features/locations/pointPlaces";
import { searchTerms } from "@/features/locations/placeSearch";
import { highlight } from "@/shared/lib/highlight";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { safeSession } from "@/shared/lib/storage";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Armchair, BookOpen, Building2, ConciergeBell, MapPin, Rotate3d, Search, Sparkles, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const KINDS: { kind: PlaceKind | "all"; key: TranslationKey; icon: typeof MapPin }[] = [
  { kind: "all", key: "mapsCatAll", icon: MapPin },
  { kind: "block", key: "mapsCatBlocks", icon: Building2 },
  { kind: "food", key: "mapsCatFood", icon: UtensilsCrossed },
  { kind: "study", key: "mapsCatStudy", icon: BookOpen },
  { kind: "service", key: "mapsCatServices", icon: ConciergeBell },
  { kind: "rest", key: "mapsCatRest", icon: Armchair },
  { kind: "tour", key: "mapsCatTour", icon: Rotate3d },
];


const EXAMPLES = ["F205", "асхана", "library", "SDU Life"];
/** The start, remembered for this browser session (students usually ask from the room they sit in). */
const START_KEY = "ai_helpdesk_map_from";

export function MapsPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const kind = (params.get("cat") ?? "all") as PlaceKind | "all";
  const [draft, setDraft] = useState(q);
  const [from, setFrom] = useState<Entrance>("C");
  useEffect(() => setDraft(q), [q]);

  const code = parseRoomCode(q);
  // A room code that names a place (D117 = lecture hall "Bochka A") opens that place.
  const roomPlace = code ? placeForRoom(code.code) : undefined;
  const room = roomPlace ? null : code;
  // The points admins keep on the floor plans (advising desk, cloakroom, labs…) are searchable places too.
  const { data: points } = useMapPoints();
  const extra = useMemo(() => pointPlaces(points ?? []), [points]);
  const results = useMemo(() => {
    const list = q.trim() ? searchPlaces(q, extra) : kind === "all" ? PLACES.filter((p) => p.popular) : [...PLACES, ...extra];
    return kind === "all" ? list : list.filter((p) => p.kind === kind);
  }, [q, kind, extra]);
  const picked = [...PLACES, ...BLOCK_FLOORS, ...extra].find((p) => p.code === params.get("place"));
  const target = room ?? (roomPlace ? { ...roomPlace, floor: code!.floor } : undefined) ?? picked ?? (q.trim() ? results[0] : undefined);
  // The route can start from a room or place instead of an entrance (?from=F205).
  const startCode = params.get("from");
  const start = useMemo((): Place | RoomCode | undefined => {
    if (!startCode) return undefined;
    const rc = parseRoomCode(startCode);
    if (rc) {
      const pl = placeForRoom(rc.code);
      return pl ? { ...pl, floor: rc.floor } : rc;
    }
    return [...PLACES, ...BLOCK_FLOORS, ...extra].find((p) => p.code === startCode);
  }, [startCode, extra]);
  // Only a start drawn on the scheme (a block, lecture hall, canteen…) has a route from it.
  const startRoutable = Boolean(start && legFromHall(schemeBlockOf(start), "room" in start ? undefined : start.spot));
  const startName = start ? ("room" in start ? start.code : start.name[locale]) : "";
  const startNote = !start
    ? undefined
    : target && start.code === target.code
      ? t("mapsStartSame").replace("{name}", startName)
      : !startRoutable
        ? t("mapsStartNoRoute").replace("{name}", startName)
        : undefined;

  // The map's floor, shared with the steps: a tapped step shows its floor
  // (n counts the taps, so the same floor can be asked for again).
  const [mapFloor, setMapFloor] = useState<MapFloor>();
  const [floorAsk, setFloorAsk] = useState<{ floor: MapFloor; n: number }>();
  const showFloor = (floor: MapFloor) => {
    setFloorAsk((a) => ({ floor, n: (a?.n ?? 0) + 1 }));
    // On phones the map is above the steps: bring it into view.
    const map = document.getElementById("campus-map");
    if (map && map.getBoundingClientRect().top < 0) map.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };

  // What Barys says on the map: where to and, for upper floors, which floor.
  const fill = (text: string, vars: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
  const guide = (() => {
    if (!target) return undefined;
    const name = "room" in target ? target.code : target.kind === "block" && target.block ? fill(t("mapsBlock"), { block: target.block }) : target.name[locale];
    const floor = target.floor;
    const level = "room" in target ? levelOf(target.floor, target.room) : floor;
    // From a room or place: say where from (and no "up": the way may go down first).
    if (start && startRoutable && start.code !== target.code) {
      return floor && floor > 1
        ? fill(t("mapsGuideFromFloor"), { start: startName, name, floor: level ?? floor })
        : fill(t("mapsGuideFrom"), { start: startName, name });
    }
    return floor && floor > 1 ? fill(t("mapsGuideFloor"), { name, floor: level ?? floor }) : fill(t("mapsGuide"), { name });
  })();

  // The card on the map shows only for a place picked on the map.
  const [mapPick, setMapPick] = useState(false);
  const update = (next: Record<string, string | null>, fromMap = false) => {
    setMapPick(fromMap);
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true, preventScrollReset: true });
  };
  // A pin tapped on the map opens the place or room it stands for, with its
  // full card (photos, 3D tour, link): a linked place (Red Hall), a room code
  // (F205; D117 opens its lecture hall), else the point itself as a place.
  // Toilets, stairs and codeless entrances aren't places: undefined.
  const openPoint = (p: MapPoint): string | undefined => {
    const linked = p.place && PLACES.some((x) => x.code === p.place) ? p.place : undefined;
    const room = parseRoomCode(p.code);
    const placeCode = linked ?? (room ? placeForRoom(room.code)?.code : undefined) ?? extra.find((x) => x.code === `${POINT_PLACE_PREFIX}${p.id}`)?.code;
    if (placeCode) {
      update({ q: null, cat: null, place: placeCode }, true);
      return placeCode;
    }
    if (room) {
      update({ q: room.code, cat: null, place: null }, true);
      return room.code;
    }
    return undefined;
  };
  const popup = !mapPick || !target
    ? undefined
    : "room" in target
      ? {
          title: fill(t("mapsRoomTitle"), { code: target.code }),
          text: [fill(t("mapsBlock"), { block: target.block }), fill(t("mapsFloor"), { floor: target.floor })].join(" · "),
        }
      : { title: target.name[locale], text: target.where[locale] };

  // (b) Remember the start for the session, and bring it back on the next visit to the map.
  useEffect(() => {
    if (!params.get("from")) {
      const saved = safeSession.get(START_KEY);
      if (saved) update({ from: saved });
    }
    // Once, when the page opens.
  }, []);
  useEffect(() => {
    if (startCode) safeSession.set(START_KEY, startCode);
  }, [startCode]);
  const setStart = (code: string | null) => {
    if (!code) safeSession.remove(START_KEY);
    update({ from: code });
  };
  // (a) "Start from here": this place becomes the start; then the student types where they go.
  const startHere = (code: string) => {
    update({ from: code, q: null, place: null, cat: null });
    setDraft("");
    requestAnimationFrame(() => document.getElementById("maps-search")?.focus({ preventScroll: true }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update({ q: draft.trim() || null, place: null });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-primary">{t("mapsTitle")}</h1>
            <p className="mt-1 text-sm text-label">{t("mapsSubtitle")}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate("/chat", { state: { draftQuery: q || t("mapsAskAiDraft") }, viewTransition: true })}>
            <Sparkles className="h-4 w-4" />
            {t("mapsAskAi")}
          </Button>
        </div>
        <SearchBox
          draft={draft}
          setDraft={setDraft}
          extra={extra}
          onSubmit={submit}
          onPickPlace={(p) => {
            setDraft("");
            update({ q: null, cat: null, place: p.code });
          }}
          onPickRoom={(code) => update({ q: code, cat: null, place: null })}
        />
        <StartField
          from={from}
          start={start}
          note={startNote}
          extra={extra}
          onEntrance={(e) => {
            setFrom(e);
            setStart(null);
          }}
          onStart={setStart}
        />
        <p className="mt-2 text-xs text-label">
          {t("mapsTry")}{" "}
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>
              <button type="button" className="font-medium text-brand hover:underline dark:text-primary" onClick={() => update({ q: ex, place: null })}>{ex}</button>
              {i < EXAMPLES.length - 1 ? " · " : ""}
            </span>
          ))}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {KINDS.map(({ kind: k, key, icon: Icon }) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => update({ cat: k === "all" ? null : k, q: null, place: null })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                kind === k ? "border-brand bg-brand text-white" : "border-border bg-surface text-primary hover:bg-background-2",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(key)}
            </button>
          ))}
        </div>
      </Card>

      {/* The map comes before the details: picking a place changes only what is below it, so the map stays put. */}
      <div className="space-y-6">
        <Card id="campus-map" className="scroll-mt-20">
          <h2 className="mb-3 font-semibold text-primary">{t("mapsMapTitle")}</h2>
          <CampusMap
            target={target}
            // A category chip marks all its places on the map (until one is picked).
            marked={kind !== "all" ? results : undefined}
            from={from}
            start={startRoutable ? start : undefined}
            showFloor={floorAsk}
            onFloorChange={setMapFloor}
            // Clicking the picked place again clears it.
            onPick={(code) => update({ q: null, cat: null, place: code === target?.code ? null : code }, code !== target?.code)}
            onPointPick={openPoint}
            popup={popup}
            onMore={() => document.getElementById("place-details")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" })}
            onStartHere={target && target.code !== startCode ? () => startHere(target.code) : undefined}
            onClosePopup={() => setMapPick(false)}
            onClear={() => update({ q: null, place: null })}
            guide={guide}
          />
        </Card>

        <Card id="place-details" className="scroll-mt-20 space-y-5">
          {/* A block's floor (BLOCK_F_2) keeps its block marked in the list. */}
          {(q.trim() || kind !== "all") && !room && (
            <PlaceList places={results} selected={target?.code.replace(/^(BLOCK_[A-I])_\d$/, "$1")} onPick={(p) => update({ place: p.code })} />
          )}
          {target ? (
            <PlaceDetails
              target={target}
              from={from}
              start={start}
              startRoutable={startRoutable}
              mapFloor={mapFloor}
              onShowFloor={showFloor}
              onStartHere={target.code !== startCode ? () => startHere(target.code) : undefined}
              onPlace={(code) => update({ q: null, place: code })}
            />
          ) : q.trim() ? (
            <NotFound q={q} />
          ) : (
            <p className="text-sm text-label">{t("mapsEmpty")}</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-bold text-primary">{t("mapsPopular")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PLACES.filter((p) => p.popular).map((p) => {
            const Icon = KIND_ICON[p.kind];
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => {
                  update({ q: null, cat: null, place: p.code });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-2xl border border-border bg-surface p-4 text-left transition-colors hover:bg-background-2"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-background-2 text-primary"><Icon className="h-5 w-5" /></span>
                <p className="mt-3 font-semibold text-primary">{p.name[locale]}</p>
                <p className="mt-1 line-clamp-2 text-sm text-label">{p.where[locale]}</p>
                {p.contact && <p className="mt-1 text-xs text-label">{p.contact}</p>}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/**
 * The search box with suggestions while typing (like the forum's search):
 * places by word starts and small typos, map points included, and a room
 * code decoded at once. ↑/↓ choose, Enter opens, Esc closes.
 */
function SearchBox({ draft, setDraft, extra, onSubmit, onPickPlace, onPickRoom }: {
  draft: string;
  setDraft: (v: string) => void;
  extra: Place[];
  onSubmit: (e: FormEvent) => void;
  onPickPlace: (p: Place) => void;
  onPickRoom: (code: string) => void;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const room = parseRoomCode(draft);
  const places = useMemo(() => (draft.trim().length >= 2 ? searchPlaces(draft, extra).slice(0, 6) : []), [draft, extra]);
  const items: ({ kind: "room"; code: string } | { kind: "place"; place: Place })[] = [
    ...(room ? [{ kind: "room" as const, code: room.code }] : []),
    ...places.map((place) => ({ kind: "place" as const, place })),
  ];
  const show = open && items.length > 0;
  const words = searchTerms(draft);
  const pick = (i: number) => {
    const item = items[i];
    if (!item) return;
    setOpen(false);
    setActive(-1);
    if (item.kind === "room") onPickRoom(item.code);
    else onPickPlace(item.place);
  };

  return (
    <form
      onSubmit={(e) => {
        if (show && active >= 0) {
          e.preventDefault();
          pick(active);
          return;
        }
        setOpen(false);
        onSubmit(e);
      }}
      className="relative mt-4"
    >
      <div className="flex items-center gap-2 rounded-2xl border-2 border-primary/80 bg-surface py-1.5 pl-3 pr-1.5 focus-within:border-brand">
        <Search className="h-5 w-5 shrink-0 text-label" />
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={t("mapsSearchPlaceholder")}
          aria-label={t("mapsSearchPlaceholder")}
          aria-expanded={show}
          aria-controls="maps-suggestions"
          aria-autocomplete="list"
          role="combobox"
          id="maps-search"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-base text-primary outline-none placeholder:text-placeholder"
        />
        <Button type="submit" size="sm">{t("mapsFind")}</Button>
      </div>
      {show ? (
        <ul id="maps-suggestions" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-2xl border border-border bg-surface py-1 shadow-lg">
          {items.map((item, i) => {
            const Icon = item.kind === "room" ? Building2 : KIND_ICON[item.place.kind];
            return (
              <li key={item.kind === "room" ? `room-${item.code}` : item.place.code} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // Before the input's blur closes the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", i === active ? "bg-background-2" : "hover:bg-background-2")}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-2 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    {item.kind === "room" ? (
                      <>
                        <span className="block text-sm font-semibold text-primary">{t("mapsRoomTitle").replace("{code}", item.code)}</span>
                        <span className="block text-xs text-label">
                          {t("mapsBlock").replace("{block}", item.code[0])} · {t("mapsFloorTab").replace("{floor}", item.code[1])}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block truncate text-sm font-semibold text-primary">{highlight(item.place.name[locale], words)}</span>
                        <span className="block truncate text-xs text-label">{item.place.where[locale]}</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </form>
  );
}

function PlaceList({ places, selected, onPick }: { places: Place[]; selected?: string; onPick: (p: Place) => void }) {
  const { locale } = useLocale();
  if (places.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-2 border-b border-border/60 pb-4">
      {places.map((p) => (
        <li key={p.code}>
          <button
            type="button"
            onClick={() => onPick(p)}
            aria-pressed={p.code === selected}
            className={cn(
              "rounded-xl border px-3 py-1.5 text-sm transition-colors",
              p.code === selected ? "border-brand bg-background-2 font-semibold text-primary" : "border-border text-primary hover:bg-background-2",
            )}
          >
            {p.name[locale]}
          </button>
        </li>
      ))}
    </ul>
  );
}

function NotFound({ q }: { q: string }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  return (
    <div className="space-y-3 py-6 text-center">
      <Mascot mood="sad" size="md" className="mx-auto" />
      <p className="font-semibold text-primary">{t("mapsNotFound").replace("{q}", q)}</p>
      <p className="text-sm text-label">{t("mapsNotFoundHint")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => navigate("/chat", { state: { draftQuery: q }, viewTransition: true })}>
          <Sparkles className="h-4 w-4" />
          {t("mapsAskAi")}
        </Button>
        <Button size="sm" onClick={() => navigate(`/forum?q=${encodeURIComponent(q)}`, { viewTransition: true })}>
          {t("mapsAskForum")}
        </Button>
      </div>
    </div>
  );
}
