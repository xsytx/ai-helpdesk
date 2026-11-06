import { Mascot } from "@/shared/ui/Mascot";
import { CampusScheme } from "@/features/locations/components/CampusScheme";
import { KIND_ICON, PlaceDetails, schemeBlockOf } from "@/features/locations/components/PlaceDetails";
import { PLACES, parseRoomCode, placeForRoom, searchPlaces, type Entrance, type Place, type PlaceKind } from "@/features/locations/places";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Armchair, BookOpen, Building2, ConciergeBell, MapPin, Search, Sparkles, UtensilsCrossed } from "lucide-react";
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
];


const EXAMPLES = ["F205", "асхана", "library", "SDU Life"];

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
  const results = useMemo(() => {
    const list = q.trim() ? searchPlaces(q) : kind === "all" ? PLACES.filter((p) => p.popular) : PLACES;
    return kind === "all" ? list : list.filter((p) => p.kind === kind);
  }, [q, kind]);
  const picked = PLACES.find((p) => p.code === params.get("place"));
  const target = room ?? (roomPlace ? { ...roomPlace, floor: code!.floor } : undefined) ?? picked ?? (q.trim() ? results[0] : undefined);

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
        <form onSubmit={submit} className="mt-4 flex items-center gap-2 rounded-2xl border-2 border-primary/80 bg-surface py-1.5 pl-3 pr-1.5 focus-within:border-brand">
          <Search className="h-5 w-5 shrink-0 text-label" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("mapsSearchPlaceholder")}
            aria-label={t("mapsSearchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base text-primary outline-none placeholder:text-label/70"
          />
          <Button type="submit" size="sm">{t("mapsFind")}</Button>
        </form>
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
              onClick={() => update({ cat: k === "all" ? null : k, place: null })}
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
        <Card>
          <details open className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between">
              <h2 className="font-semibold text-primary">{t("mapsSchemeTitle")}</h2>
              <span className="text-xs text-label">{t("mapsGroundFloor")}</span>
            </summary>
            <div className="mt-4">
              <CampusScheme
                block={target ? schemeBlockOf(target) : undefined}
                spot={target && "spot" in target ? target.spot : undefined}
                from={from}
                // Clicking the picked place again clears it.
                onPick={(code) => update({ q: null, cat: null, place: code === target?.code ? null : code }, code !== target?.code)}
                popup={mapPick && picked ? { title: picked.name[locale], text: picked.where[locale] } : undefined}
                onMore={() => document.getElementById("place-details")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" })}
                onClosePopup={() => setMapPick(false)}
                onClear={() => update({ q: null, place: null })}
              />
            </div>
          </details>
        </Card>

        <Card id="place-details" className="scroll-mt-20 space-y-5">
          {(q.trim() || kind !== "all") && !room && (
            <PlaceList places={results} selected={target?.code} onPick={(p) => update({ place: p.code })} />
          )}
          {target ? (
            <PlaceDetails target={target} from={from} onFrom={setFrom} />
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
