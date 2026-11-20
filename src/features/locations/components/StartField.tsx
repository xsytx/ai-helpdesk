// "From": where the route starts, next to the search box (which is the "To").
// An entrance (C, G, I) or any room or place: F205, "library"… The choice
// folds into one button; tapping it opens the entrances and a box with
// suggestions while typing (Enter takes the first one).
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { ChevronDown, DoorOpen, MapPin, X } from "lucide-react";
import { useState } from "react";
import { ENTRANCE_KEY, ENTRANCE_ORDER, parseRoomCode, searchPlaces, type Entrance, type Place, type RoomCode } from "../places";

export function StartField({ from, start, note, extra, onEntrance, onStart }: {
  from: Entrance;
  /** A room or place the route starts from instead of the entrance. */
  start?: Place | RoomCode;
  /** Why the start isn't used (no route from there, or it is the place itself). */
  note?: string;
  /** More places to start from (map points). */
  extra: Place[];
  onEntrance: (e: Entrance) => void;
  /** A room or place by its code, or null = back to the entrance. */
  onStart: (code: string | null) => void;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const room = parseRoomCode(draft);
  const places = draft.trim().length >= 2 ? searchPlaces(draft, extra).slice(0, 5) : [];
  const options = [
    ...(room ? [{ code: room.code, label: room.code }] : []),
    ...places.map((p) => ({ code: p.code, label: p.name[locale] })),
  ];
  const name = start ? ("room" in start ? start.code : start.name[locale]) : t(ENTRANCE_KEY[from]);
  const pick = (code: string) => {
    onStart(code);
    setDraft("");
    setOpen(false);
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-label">{t("mapsFrom")}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-primary hover:bg-background-2"
        >
          {start ? <MapPin className="h-4 w-4 shrink-0 text-accent" /> : <DoorOpen className="h-4 w-4 shrink-0 text-label" />}
          <span className="truncate">{name}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-label transition-transform", open && "rotate-180")} />
        </button>
        {start ? (
          <button
            type="button"
            onClick={() => {
              onStart(null);
              setOpen(false);
            }}
            aria-label={t("mapsStartClear")}
            title={t("mapsStartClear")}
            className="rounded-lg p-1.5 text-label hover:bg-background-2 hover:text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {note ? <p className="mt-1.5 text-xs text-label">{note}</p> : null}

      {open ? (
        <div className="mt-2 space-y-2 rounded-2xl border border-border bg-background-2 p-3">
          <div className="flex flex-wrap gap-1.5">
            {ENTRANCE_ORDER.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={!start && from === e}
                onClick={() => {
                  onEntrance(e);
                  setOpen(false);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  !start && from === e ? "border-brand bg-brand text-white" : "border-border bg-surface text-primary hover:bg-background-2",
                )}
              >
                <DoorOpen className="h-3.5 w-3.5" />
                {t(ENTRANCE_KEY[e])}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (options[0]) pick(options[0].code);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder={t("mapsStartPlaceholder")}
              aria-label={t("mapsStartPlaceholder")}
              autoComplete="off"
              autoFocus
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary outline-none placeholder:text-label/70 focus:border-brand"
            />
          </form>
          {options.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {options.map((o) => (
                <li key={o.code}>
                  <button
                    type="button"
                    onClick={() => pick(o.code)}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-primary hover:bg-background-2"
                  >
                    <MapPin className="h-3 w-3 text-label" />
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
