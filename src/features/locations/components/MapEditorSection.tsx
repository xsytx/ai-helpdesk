// Admin panel → "Map editor": the floor plans with every point. Click a point
// to edit it, drag it to move it (saved on drop), nudge it with the arrow
// keys, add points (a new one can be dragged before it is saved, and "add
// next" continues with the next room code), delete them, and undo any change
// from the change log. Open "Report a mistake" reports are marked on their
// points; a student's suggested spot shows as a green pin and is applied in
// one click. Students load the points on every visit to the Maps page, so a
// change reaches them at once.
import { useLocale } from "@/i18n/LocaleContext";
import { getErrorStatus } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { Check, Crosshair, History, MapPin, Plus, Search, Trash2, Undo2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocationReports, useSetLocationReportStatus, type LocationReport } from "../api";
import {
  FLOOR_ORDER, PLAN_BLOCKS, POINT_TYPES, TYPE_META, pointsFor, useDeleteMapPoint, useMapChanges, useMapPoints, useSaveMapPoint,
  type MapFloor, type MapPoint, type MapPointChange, type MapPointDraft, type PointType,
} from "../mapPoints";
import { PLACES, parseRoomCode } from "../places";
import { FloorPlan } from "./FloorPlan";
import { pointIdOf } from "../pointPlaces";

const placeRooms = (code: string) => PLACES.find((p) => p.code === code)?.rooms ?? [];

/** Where a report sits on the plans: its points, or (for "BLOCK_F" and rooms not on the plan) its block letter. */
function reportTarget(r: LocationReport, points: MapPoint[]) {
  const pointId = pointIdOf(r.placeCode);
  const matched = pointId ? points.filter((p) => p.id === pointId) : pointsFor(points, r.placeCode, placeRooms(r.placeCode));
  const letter = /^BLOCK_([A-I])$/.exec(r.placeCode)?.[1] ?? /^([A-I])\d{3}$/.exec(r.placeCode)?.[1];
  return { matched, block: matched.length === 0 ? letter : undefined };
}

/** The next room code after this one: F201 → F202, I109 → I110 ("" if it has no number at the end). */
function nextCode(code: string): string {
  const m = /^(.*?)(\d+)$/.exec(code.trim());
  if (!m) return "";
  const n = String(Number(m[2]) + 1).padStart(m[2].length, "0");
  return m[1] + n;
}

const toDraft = (p: MapPoint): MapPointDraft => ({ code: p.code, name: p.name, type: p.type, floor: p.floor, x: p.x, y: p.y, place: p.place });

export function MapEditorSection() {
  const { t, locale } = useLocale();
  const { data: points, isPending, isError } = useMapPoints();
  const reports = useLocationReports("open").data ?? [];
  const changes = useMapChanges().data ?? [];
  const save = useSaveMapPoint();
  const remove = useDeleteMapPoint();
  const setReport = useSetLocationReportStatus();

  const [floor, setFloor] = useState<MapFloor>("1");
  const [selectedId, setSelectedId] = useState<string | "new">();
  const [form, setForm] = useState<MapPointDraft>();
  /** Waiting for a click on the plan to place a new point; the template fills its form. */
  const [adding, setAdding] = useState<Partial<MapPointDraft> | null>(null);
  const [focus, setFocus] = useState<{ x: number; y: number; key: string } | null>(null);
  const [blockMark, setBlockMark] = useState<string>();
  const [activeReport, setActiveReport] = useState<string>();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [showLog, setShowLog] = useState(false);

  const all = useMemo(() => points ?? [], [points]);
  const reportInfo = useMemo(() => reports.map((r) => ({ report: r, ...reportTarget(r, all) })), [reports, all]);
  const reported: Record<string, number> = {};
  for (const { matched } of reportInfo) for (const p of matched) reported[p.id] = (reported[p.id] ?? 0) + 1;
  const reportsOnFloor = (f: MapFloor) =>
    reportInfo.filter((i) => i.matched.some((p) => p.floor === f) || (i.block && f === "1") || i.report.suggested?.floor === f).length;
  const active = reportInfo.find((i) => i.report.id === activeReport);
  const ghost =
    active?.report.suggested && active.report.suggested.floor === floor
      ? { x: active.report.suggested.x, y: active.report.suggested.y, label: t("mapEditorSuggested") }
      : null;

  const errorText = useCallback((err: unknown) => (getErrorStatus(err) === 409 ? t("mapEditorCodeTaken") : t("mapEditorFailed")), [t]);

  const select = (p: MapPoint, look = false) => {
    setSelectedId(p.id);
    setForm(toDraft(p));
    setFloor(p.floor);
    setAdding(null);
    setMessage(undefined);
    setBlockMark(undefined);
    if (look) setFocus({ x: p.x, y: p.y, key: `${p.id}-${Date.now()}` });
  };
  const close = useCallback(() => {
    setSelectedId(undefined);
    setForm(undefined);
    setMessage(undefined);
  }, []);

  /** Save a point (new or changed) and keep it selected. */
  const persist = (draft: MapPointDraft, id: string | undefined, after?: (saved: MapPoint) => void) =>
    save.mutate(
      { ...draft, id },
      {
        onSuccess: (saved) => {
          select(saved);
          setMessage({ ok: true, text: t("mapEditorSaved") });
          after?.(saved);
        },
        onError: (err) => setMessage({ ok: false, text: errorText(err) }),
      },
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const isNew = selectedId === "new";
    persist(form, isNew ? undefined : selectedId, (saved) => {
      // "Add next": the following room code, same type and floor; a click on the plan places it.
      if (isNew) setAdding({ type: saved.type, floor: saved.floor, place: "", code: nextCode(saved.code) });
    });
  };

  const move = (p: MapPoint, x: number, y: number) => {
    const draft = selectedId === p.id && form ? { ...form, x, y } : { ...toDraft(p), x, y };
    setForm(draft);
    persist(draft, p.id);
  };

  // Arrow keys nudge the selected point (Shift = 10 px), saved shortly after the last press. Esc stops adding / closes.
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const formRef = useRef(form);
  formRef.current = form;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "Escape") {
        setAdding(null);
        close();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const d = moves[e.key];
      const current = formRef.current;
      if (!d || !current || !selectedId) return;
      e.preventDefault();
      const next = { ...current, x: Math.max(0, current.x + d[0]), y: Math.max(0, current.y + d[1]) };
      setForm(next);
      if (selectedId === "new") return; // a new point is saved with its form
      clearTimeout(nudgeTimer.current);
      const id = selectedId;
      nudgeTimer.current = setTimeout(
        () => save.mutate({ ...next, id }, { onSuccess: () => setMessage({ ok: true, text: t("mapEditorSaved") }), onError: (err) => setMessage({ ok: false, text: errorText(err) }) }),
        500,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, save, close, errorText, t]);
  useEffect(() => () => clearTimeout(nudgeTimer.current), []);

  const find = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hit = all.find((p) => p.code.toLowerCase() === q) ?? all.find((p) => `${p.code} ${p.name}`.toLowerCase().includes(q));
    if (hit) select(hit, true);
    else setMessage({ ok: false, text: t("mapEditorNotFound") });
  };

  const showReport = (i: (typeof reportInfo)[number]) => {
    setActiveReport(i.report.id);
    const s = i.report.suggested;
    if (i.matched[0]) {
      const onSpotFloor = s ? i.matched.find((p) => p.floor === s.floor) : undefined;
      select(onSpotFloor ?? i.matched[0], true);
      if (s) {
        setFloor(s.floor);
        setFocus({ x: s.x, y: s.y, key: `spot-${i.report.id}-${Date.now()}` });
      }
      return;
    }
    close();
    setAdding(null);
    if (s) {
      setFloor(s.floor);
      setFocus({ x: s.x, y: s.y, key: `spot-${i.report.id}-${Date.now()}` });
      return;
    }
    const b = PLAN_BLOCKS.find((x) => x.block === i.block);
    setFloor("1");
    setBlockMark(i.block);
    if (b) setFocus({ x: b.x, y: b.y, key: `block-${i.block}-${Date.now()}` });
  };

  /** Move the report's point to the student's spot (or add the point there), then mark the report fixed. */
  const applySuggestion = (i: (typeof reportInfo)[number]) => {
    const s = i.report.suggested;
    if (!s) return;
    const far = (p: MapPoint) => (p.floor === s.floor ? 0 : 1e9) + Math.hypot(p.x - s.x, p.y - s.y);
    const point = [...i.matched].sort((a, b) => far(a) - far(b))[0];
    const room = parseRoomCode(i.report.placeCode);
    const draft: MapPointDraft = point
      ? { ...toDraft(point), floor: s.floor, x: s.x, y: s.y }
      : {
          code: room ? room.code : "",
          name: room ? "" : i.report.placeName,
          type: "room",
          floor: s.floor,
          x: s.x,
          y: s.y,
          place: room ? "" : i.report.placeCode,
        };
    persist(draft, point?.id, () => {
      setReport.mutate({ id: i.report.id, status: "fixed" });
      setActiveReport(undefined);
      setFloor(s.floor);
      setMessage({ ok: true, text: t("mapEditorApplied") });
    });
  };

  /** Undo one logged change: a new point is deleted, a change is reverted, a deleted point comes back. */
  const exists = (id: string) => all.some((p) => p.id === id);
  const undo = (c: MapPointChange) => {
    const onError = (err: unknown) => setMessage({ ok: false, text: errorText(err) });
    const onSuccess = () => setMessage({ ok: true, text: t("mapEditorUndone") });
    if (c.action === "create" && exists(c.pointId)) {
      remove.mutate(c.pointId, {
        onSuccess: () => {
          close();
          onSuccess();
        },
        onError,
      });
    } else if (c.action === "update" && c.before && exists(c.pointId)) {
      save.mutate({ ...c.before, id: c.pointId }, { onSuccess: (p) => { select(p, true); onSuccess(); }, onError });
    } else if (c.action === "delete" && c.before) {
      save.mutate({ ...c.before }, { onSuccess: (p) => { select(p, true); onSuccess(); }, onError });
    }
  };
  const canUndo = (c: MapPointChange) => (c.action === "delete" ? Boolean(c.before) : exists(c.pointId));

  if (isPending) return <p className="text-sm text-label">{t("loading")}</p>;
  if (isError) return <p className="text-sm text-error">{t("insightsLoadFailed")}</p>;

  const field = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-primary outline-none focus:border-brand";
  const onThisFloor = all.filter((p) => p.floor === floor).length;
  const changeName = (c: MapPointChange) => {
    const d = c.after ?? c.before;
    if (!d) return `#${c.pointId}`;
    return d.code || d.name || t((TYPE_META[d.type as PointType] ?? TYPE_META.other).key);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-label">{t("mapEditorIntro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-border bg-surface p-0.5 text-sm font-semibold" role="group" aria-label={t("mapEditorFloor")}>
          {FLOOR_ORDER.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFloor(f);
                setFocus(null);
                setBlockMark(undefined);
              }}
              aria-pressed={floor === f}
              className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-1.5", floor === f ? "bg-brand text-white" : "text-label hover:text-primary")}
            >
              {t("mapsFloorTab").replace("{floor}", f)}
              {reportsOnFloor(f) > 0 ? (
                <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">{reportsOnFloor(f)}</span>
              ) : null}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant={adding ? "primary" : "secondary"}
          aria-pressed={Boolean(adding)}
          onClick={() => {
            setAdding(adding ? null : { type: "room", floor, place: "", code: "" });
            setMessage(undefined);
          }}
        >
          <Plus className="h-4 w-4" />
          {t("mapEditorAdd")}
        </Button>
        <Button size="sm" variant={showLog ? "primary" : "secondary"} aria-pressed={showLog} onClick={() => setShowLog((v) => !v)}>
          <History className="h-4 w-4" />
          {t("mapEditorChanges")}
        </Button>
        <form onSubmit={find} className="flex min-w-[12rem] flex-1 items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-1">
          <Search className="h-4 w-4 shrink-0 text-label" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mapEditorSearch")}
            aria-label={t("mapEditorSearch")}
            className="min-w-0 flex-1 bg-transparent py-1 text-sm text-primary outline-none placeholder:text-label/70"
          />
        </form>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative">
          {/* Over the plan, not above it: the plan must not move when the hint comes and goes. */}
          {adding ? (
            <p className="pointer-events-none absolute left-2 top-2 z-10 max-w-[75%] rounded-lg bg-surface/95 px-2.5 py-1.5 text-xs font-semibold text-accent shadow-md">
              {adding.code ? t("mapEditorAddNext").replace("{code}", adding.code) : t("mapEditorAddHint")}
            </p>
          ) : null}
          <FloorPlan
            floor={floor}
            points={all}
            selectedId={selectedId === "new" ? undefined : selectedId}
            reported={reported}
            block={blockMark}
            focus={focus}
            ghost={ghost}
            wheelZoom
            picking={Boolean(adding)}
            onPointClick={(p) => select(p)}
            onPointMove={move}
            onPlanClick={(x, y) => {
              if (adding) {
                setSelectedId("new");
                setForm({ code: adding.code ?? "", name: "", type: adding.type ?? "room", floor, x, y, place: adding.place ?? "" });
                setAdding(null);
                setMessage(undefined);
              } else if (selectedId !== "new") {
                // A click on an empty spot puts the point down.
                close();
              }
            }}
            draft={selectedId === "new" && form ? { x: form.x, y: form.y } : null}
            onDraftMove={(x, y) => setForm((f) => (f ? { ...f, x, y } : f))}
            className="h-[340px] md:h-[440px]"
          />
          <p className="mt-2 text-xs text-label">
            {t("mapEditorCount").replace("{n}", String(onThisFloor))} · {t("mapEditorHelp")}
          </p>
        </div>

        <aside className="space-y-4">
          {form ? (
            <form onSubmit={submit} className="space-y-2.5 rounded-2xl border border-border bg-surface p-3" aria-label={t("mapEditorNew")}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-primary">{selectedId === "new" ? t("mapEditorNew") : form.code || form.name || t(TYPE_META[form.type].key)}</p>
                <button type="button" onClick={close} aria-label={t("close")} className="rounded-lg p-1 text-label hover:bg-background-2">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <label className="block text-xs font-semibold text-label">
                {t("mapEditorCode")}
                <input
                  className={cn(field, "mt-1 font-mono")}
                  value={form.code}
                  maxLength={40}
                  placeholder="F205"
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-label">
                {t("mapEditorName")}
                <input className={cn(field, "mt-1")} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-semibold text-label">
                  {t("mapEditorType")}
                  <select className={cn(field, "mt-1")} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PointType })}>
                    {POINT_TYPES.map((type) => (
                      <option key={type} value={type}>{t(TYPE_META[type].key)}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-label">
                  {t("mapEditorFloor")}
                  <select className={cn(field, "mt-1")} value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value as MapFloor })}>
                    {FLOOR_ORDER.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-semibold text-label">
                {t("mapEditorPlace")}
                <select className={cn(field, "mt-1")} value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })}>
                  <option value="">{t("mapEditorNone")}</option>
                  {PLACES.map((p) => (
                    <option key={p.code} value={p.code}>{p.name[locale]}</option>
                  ))}
                </select>
              </label>
              <p className="flex items-start gap-1.5 text-xs text-label">
                <Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {selectedId === "new" ? t("mapEditorNewHint") : t("mapEditorDragHint")} ({form.x}, {form.y})
                </span>
              </p>
              {message ? <p className={cn("text-sm", message.ok ? "text-green-700" : "text-error")} role="status">{message.text}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={save.isPending}>
                  <Check className="h-4 w-4" />
                  {t("mapEditorSave")}
                </Button>
                {selectedId !== "new" && selectedId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (!window.confirm(t("mapEditorDeleteConfirm"))) return;
                      remove.mutate(selectedId, {
                        onSuccess: () => {
                          close();
                          setMessage({ ok: true, text: t("mapEditorDeleted") });
                        },
                        onError: () => setMessage({ ok: false, text: t("mapEditorFailed") }),
                      });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("mapEditorDelete")}
                  </Button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-3 text-sm text-label">
              {message ? <p className={cn("mb-1", message.ok ? "text-green-700" : "text-error")} role="status">{message.text}</p> : null}
              {t("mapEditorPick")}
            </div>
          )}

          {showLog ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-label">{t("mapEditorChanges")}</h3>
              {changes.length === 0 ? <p className="text-sm text-label">{t("mapEditorNoChanges")}</p> : null}
              <ul className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
                {changes.slice(0, 30).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-xl bg-background-2/60 px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 flex-1">
                      <b className="text-primary">
                        {t(c.action === "create" ? "mapEditorActCreate" : c.action === "delete" ? "mapEditorActDelete" : "mapEditorActUpdate")}
                      </b>{" "}
                      <span className="font-mono text-primary">{changeName(c)}</span>
                      <span className="block text-label">
                        {c.userName} · {formatRelativeTime(c.createdAt, locale)}
                      </span>
                    </span>
                    {canUndo(c) ? (
                      <Button size="sm" variant="ghost" className="h-7 px-2" disabled={save.isPending || remove.isPending} onClick={() => undo(c)}>
                        <Undo2 className="h-3.5 w-3.5" />
                        {t("mapEditorUndo")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-label">
              {t("mapEditorReports")} ({reportInfo.length})
            </h3>
            {reportInfo.length === 0 ? <p className="text-sm text-label">{t("mapEditorNoReports")}</p> : null}
            <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1 lg:max-h-[300px]">
              {reportInfo.map((i) => (
                <li
                  key={i.report.id}
                  className={cn(
                    "rounded-xl border bg-red-50/60 p-2.5 text-sm dark:border-red-900/50",
                    activeReport === i.report.id ? "border-red-400" : "border-red-200",
                  )}
                >
                  <p className="font-semibold text-primary">
                    {i.report.placeName || i.report.placeCode}{" "}
                    <span className="font-mono text-xs font-normal text-label">{i.report.placeCode}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-primary">{i.report.text}</p>
                  <p className="mt-0.5 text-xs text-label">
                    {i.report.reporterName} · {formatRelativeTime(i.report.createdAt, locale)}
                    {i.report.suggested ? ` · ${t("mapEditorHasSpot")}` : ""}
                    {i.matched.length === 0 && !i.block && !i.report.suggested ? ` · ${t("mapEditorNotOnPlan")}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {i.matched.length > 0 || i.block || i.report.suggested ? (
                      <Button size="sm" variant="secondary" className="h-8 px-2.5" onClick={() => showReport(i)}>
                        <MapPin className="h-4 w-4" />
                        {t("mapEditorShow")}
                      </Button>
                    ) : null}
                    {i.report.suggested ? (
                      <Button size="sm" className="h-8 px-2.5" disabled={save.isPending || setReport.isPending} onClick={() => applySuggestion(i)}>
                        <Wand2 className="h-4 w-4" />
                        {t("mapEditorApply")}
                      </Button>
                    ) : (
                      <Button size="sm" className="h-8 px-2.5" disabled={setReport.isPending} onClick={() => setReport.mutate({ id: i.report.id, status: "fixed" })}>
                        <Check className="h-4 w-4" />
                        {t("mapReportsMarkFixed")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 px-0"
                      disabled={setReport.isPending}
                      aria-label={t("mapReportsReject")}
                      title={t("mapReportsReject")}
                      onClick={() => setReport.mutate({ id: i.report.id, status: "rejected" })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
