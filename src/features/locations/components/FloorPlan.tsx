// One floor plan with its points: zoom (buttons, pinch and double-tap on
// touch screens, a trackpad pinch, and the wheel where asked), drag to pan,
// click a point or an empty spot, and, in the admin editor,
// drag a point (or a new, unsaved one) to move it. Everything is drawn in the
// plan image's own pixels (viewBox); clicks are converted with the SVG's
// screen matrix, so a point's position never depends on the screen (see
// sdu-map-export/README.md).
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Mascot } from "@/shared/ui/Mascot";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { COLOR } from "../campusShapes";
import type { SchemeBlock } from "../places";
import { FLOORS, PLAN_BLOCKS, TYPE_META, pointLabel, type MapFloor, type MapPoint } from "../mapPoints";

interface View { x: number; y: number; w: number }

const DRAFT = "__draft";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface FloorPlanProps {
  floor: MapFloor;
  /** All points (the plan shows its floor's). */
  points: MapPoint[];
  /** Points to show big, labelled and pulsing (the place you look for). */
  highlight?: string[];
  /** Helper points to show labelled next to it (the nearest toilet or stairs). */
  secondary?: string[];
  /** Fade every point that isn't highlighted, secondary or selected (a category is marked). */
  dimOthers?: boolean;
  /** The point being edited (a ring; it can be dragged when onPointMove is given). */
  selectedId?: string;
  /** Points with open "Report a mistake" reports: a red mark and the count. */
  reported?: Record<string, number>;
  /** A block letter to highlight when the room itself is not on the plan yet. */
  block?: string;
  /** Where to look (w = how wide an area); changing `key` moves the view there. */
  focus?: { x: number; y: number; key: string; w?: number } | null;
  onPointClick?: (p: MapPoint) => void;
  /** A click on the plan itself (not a point), in plan pixels. */
  onPlanClick?: (x: number, y: number) => void;
  /** The plan is waiting for a spot to be picked: a crosshair cursor. */
  picking?: boolean;
  /** Dropping a dragged point (only the selected one can be dragged). */
  onPointMove?: (p: MapPoint, x: number, y: number) => void;
  /** A new, unsaved point: shown and draggable (onDraftMove). */
  draft?: { x: number; y: number } | null;
  onDraftMove?: (x: number, y: number) => void;
  /** A suggested spot (a student's "it's actually here"): a dashed green pin. */
  ghost?: { x: number; y: number; label?: string } | null;
  /** Zoom with the mouse wheel (the editor; on the students' page the wheel scrolls the page). */
  wheelZoom?: boolean;
  /**
   * Drawn over the plan image, under the pins (the campus layer on floor 1),
   * given the plan pixels per screen pixel. It replaces the plain block letters.
   */
  layer?: (k: number) => ReactNode;
  /**
   * The students' map: while zoomed out, only the important pins (the place,
   * marked ones, entrances) are drawn, so 400 pins don't cover the plan.
   */
  declutter?: boolean;
  /** The points are still loading: the mascot waits over the plan. */
  loading?: boolean;
  /** More buttons under the zoom buttons (full screen). */
  controls?: ReactNode;
  className?: string;
}

/** Zoomed out further than this (plan pixels per screen pixel), small pins are hidden. */
const DECLUTTER_K = 4.5;

export function FloorPlan({
  floor, points, highlight = [], secondary = [], dimOthers = false, selectedId, reported = {}, block, focus, onPointClick, onPlanClick, picking,
  onPointMove, draft, onDraftMove, ghost, wheelZoom, layer, declutter = false, loading = false, controls, className,
}: FloorPlanProps) {
  const { t } = useLocale();
  const plan = FLOORS[floor];
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });
  const [view, setView] = useState<View>({ x: 0, y: 0, w: plan.w });
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ kind: "pan" | "point"; id?: string; sx: number; sy: number; view: View; moved: boolean } | null>(null);
  // Fingers on the plan (pinch zoom) and the last tap (double-tap zoom).
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; at: { x: number; y: number }; view0: View } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const [loadedImage, setLoadedImage] = useState<string>();

  const aspect = size.h / size.w;
  const vh = view.w * aspect;
  /** Plan pixels per screen pixel: keeps pins and labels the same size on screen. */
  const k = view.w / size.w;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width || 1, h: e.contentRect.height || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const w = Math.max(plan.w, plan.h / aspect);
    setView({ x: (plan.w - w) / 2, y: plan.h / 2 - (w * aspect) / 2, w });
  }, [plan.w, plan.h, aspect]);

  const lookAt = useCallback(
    (x: number, y: number, w = 1500) => {
      const width = Math.min(Math.max(w, 600), plan.w);
      setView({ x: x - width / 2, y: y - (width * aspect) / 2, w: width });
    },
    [plan.w, aspect],
  );

  /**
   * The first view: the whole plan in a wide box; in a tall one (a phone) the
   * plan's full height, so it isn't a thin strip, around the middle of the
   * building (drag sideways for the rest; the fit button shows everything).
   */
  const start = useCallback(() => {
    if (aspect <= 0.6) return fit();
    const w = Math.min(plan.w, (plan.h / aspect) * 1.05);
    setView({ x: Math.min(Math.max(plan.w * 0.42 - w / 2, 0), plan.w - w), y: plan.h / 2 - (w * aspect) / 2, w });
  }, [aspect, fit, plan.w, plan.h]);

  // A new floor, a new place to look at, or a resized box: frame it again.
  const focusKey = focus ? `${focus.key}@${floor}` : `fit@${floor}`;
  useEffect(() => {
    if (focus) lookAt(focus.x, focus.y, focus.w);
    else start();
    // Only when what we look at changes (or the box's shape), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, aspect]);

  const clampW = useCallback((w: number) => Math.min(Math.max(w, 300), plan.w * 1.4), [plan.w]);
  const zoom = useCallback(
    (factor: number, cx?: number, cy?: number) =>
      setView((v) => {
        const w = clampW(v.w * factor);
        const px = cx ?? v.x + v.w / 2;
        const py = cy ?? v.y + (v.w * aspect) / 2;
        const f = w / v.w;
        return { w, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      }),
    [clampW, aspect],
  );

  /** A screen point in plan pixels for a given view (pinch math: the view changes meanwhile). */
  const planAt = (v: View, clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    const s = v.w / size.w;
    return { x: v.x + (clientX - r.left) * s, y: v.y + (clientY - r.top) * s };
  };

  const toPlan = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  const clampToPlan = (p: { x: number; y: number }) => ({
    x: Math.min(Math.max(p.x, 0), plan.w),
    y: Math.min(Math.max(p.y, 0), plan.h),
  });

  // The wheel zooms only where asked (a trackpad pinch, sent as ctrl+wheel,
  // always does), and must not scroll the page meanwhile.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!wheelZoom && !e.ctrlKey) return;
      e.preventDefault();
      const p = toPlan(e.clientX, e.clientY);
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [wheelZoom, zoom]);

  /** Can this pin be dragged? The selected point (editor), or the new unsaved one. */
  const draggable = (id: string) => (id === DRAFT ? Boolean(onDraftMove) : Boolean(onPointMove) && id === selectedId);

  // Every finger is counted before anything else handles it: two fingers = pinch.
  const onAnyDown = (e: ReactPointerEvent) => {
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size !== 2) return;
    const [a, b] = [...touches.current.values()];
    pinch.current = { d0: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, at: planAt(view, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2), view0: view };
    gesture.current = null;
    setDragPos(null);
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onAnyUp = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  };

  const onDown = (e: ReactPointerEvent, id?: string) => {
    if (e.button !== 0 || touches.current.size > 1) return;
    gesture.current = { kind: id && draggable(id) ? "point" : "pan", id, sx: e.clientX, sy: e.clientY, view, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };
  const onMove = (e: ReactPointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()];
      const w = clampW(pz.view0.w * (pz.d0 / (Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1)));
      const r = boxRef.current!.getBoundingClientRect();
      const s = w / size.w;
      // The plan spot that was between the fingers stays between them.
      setView({ w, x: pz.at.x - ((a!.x + b!.x) / 2 - r.left) * s, y: pz.at.y - ((a!.y + b!.y) / 2 - r.top) * s });
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    if (g.kind === "point" && g.id) {
      setDragPos({ id: g.id, ...clampToPlan(toPlan(e.clientX, e.clientY)) });
    } else {
      setView({ ...g.view, x: g.view.x - dx * k, y: g.view.y - dy * k });
    }
  };
  const onUp = (e: ReactPointerEvent, point?: MapPoint) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    e.stopPropagation();
    if (g.moved) {
      if (g.kind === "point" && g.id) {
        const at = clampToPlan(toPlan(e.clientX, e.clientY));
        if (g.id === DRAFT) onDraftMove?.(at.x, at.y);
        else if (point) onPointMove?.(point, at.x, at.y);
      }
      setDragPos(null);
      return;
    }
    // A double tap on the plan zooms in there (touch screens).
    if (!point && e.pointerType === "touch") {
      const now = Date.now();
      const last = lastTap.current;
      if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        lastTap.current = null;
        const p = toPlan(e.clientX, e.clientY);
        zoom(1 / 2, p.x, p.y);
        return;
      }
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    }
    // While picking a spot (adding a point), a click on top of a point picks
    // that spot too; it must never select (and so change) the point under it.
    if (point && !picking) onPointClick?.(point);
    else if (g.id !== DRAFT && onPlanClick) {
      const p = toPlan(e.clientX, e.clientY);
      if (p.x >= 0 && p.y >= 0 && p.x <= plan.w && p.y <= plan.h) onPlanClick(p.x, p.y);
    }
  };

  const hl = new Set(highlight);
  const sec = new Set(secondary);
  // Zoomed out on the students' map: only the pins that matter.
  const sparse = declutter && k > DECLUTTER_K;
  const allOnFloor = points.filter((p) => p.floor === floor);
  const onFloor = sparse ? allOnFloor.filter((p) => hl.has(p.id) || sec.has(p.id) || p.id === selectedId || p.type === "entrance") : allOnFloor;
  const hidden = allOnFloor.length - onFloor.length;
  const small = size.w < 520;
  const waiting = loading || loadedImage !== plan.image;
  const top = (p: MapPoint) => Number(hl.has(p.id) || sec.has(p.id) || p.id === selectedId);
  // Highlighted and selected points last, so they are drawn on top.
  const ordered = [...onFloor].sort((a, b) => top(a) - top(b));
  const showCodes = k < 1.6;
  // Two pins of one place side by side (the medical center): its name only once.
  const named = new Set<string>();
  const pulse = !reducedMotion();
  const label = (x: number, y: number, text: string, size = 13, color = "#1e2151") => (
    <text
      x={x} y={y} fontSize={size * k} fontWeight="700" textAnchor="middle" fill={color}
      stroke="#fff" strokeWidth={3.5 * k} paintOrder="stroke" style={{ pointerEvents: "none" }}
    >
      {text}
    </text>
  );
  const draftAt = draft ? (dragPos?.id === DRAFT ? dragPos : draft) : null;

  return (
    <div ref={boxRef} className={cn("relative overflow-hidden rounded-2xl border border-border/60 bg-white", className)}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${vh}`}
        className={cn("block h-full w-full touch-none select-none", picking ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
        onPointerDownCapture={onAnyDown}
        onPointerDown={(e) => onDown(e)}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e)}
        onPointerUpCapture={onAnyUp}
        onPointerCancelCapture={(e) => {
          onAnyUp(e);
          gesture.current = null;
          setDragPos(null);
        }}
        role={layer ? "group" : "img"}
        aria-label={t("mapsFloorTab").replace("{floor}", floor)}
      >
        <image
          href={plan.image} x="0" y="0" width={plan.w} height={plan.h}
          onLoad={() => setLoadedImage(plan.image)}
          onError={() => setLoadedImage(plan.image)}
        />

        {layer?.(k)}

        {!layer && PLAN_BLOCKS.map((b, i) => (
          <g key={i} style={{ pointerEvents: "none" }}>
            {block === b.block && (
              <circle cx={b.x} cy={b.y} r={Math.max(60, 26 * k)} fill="var(--color-accent)" fillOpacity="0.18" stroke="var(--color-accent)" strokeWidth={4 * k} />
            )}
            <circle cx={b.x} cy={b.y} r={Math.max(30, 13 * k)} fill={block === b.block ? "var(--color-accent)" : (COLOR[b.block as SchemeBlock] ?? "#1e2151")} fillOpacity={block === b.block ? 1 : 0.85} />
            <text x={b.x} y={b.y + Math.max(11, 5 * k)} fontSize={Math.max(32, 14 * k)} fontWeight="700" textAnchor="middle" fill="#fff">{b.block}</text>
          </g>
        ))}

        {ordered.map((p) => {
          const pos = dragPos?.id === p.id ? dragPos : p;
          const meta = TYPE_META[p.type];
          const isHl = hl.has(p.id);
          const isSec = !isHl && sec.has(p.id);
          const isSel = p.id === selectedId;
          const reports = reported[p.id] ?? 0;
          const r = (isHl ? 9 : isSec ? 8 : small ? 4.5 : 5.5) * k;
          const name = pointLabel(p, t);
          const showName = (isHl || isSec) && !named.has(name);
          if (showName) named.add(name);
          return (
            <g
              key={p.id}
              data-point={p.id}
              onPointerDown={(e) => onDown(e, p.id)}
              onPointerUp={(e) => onUp(e, p)}
              className={onPointClick ? "cursor-pointer" : undefined}
              style={draggable(p.id) ? { cursor: "move" } : undefined}
              opacity={dimOthers && !isHl && !isSec && !isSel ? 0.3 : undefined}
            >
              <title>{name}</title>
              {isHl && pulse && (
                <circle cx={pos.x} cy={pos.y} r={r} fill="none" stroke="var(--color-accent)" strokeWidth={3 * k}>
                  <animate attributeName="r" values={`${r};${r * 3}`} dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              {isSec && <circle cx={pos.x} cy={pos.y} r={r + 5 * k} fill={meta.color} fillOpacity="0.18" stroke={meta.color} strokeWidth={2.5 * k} />}
              {reports > 0 && (
                <circle cx={pos.x} cy={pos.y} r={14 * k} fill="#dc2626" fillOpacity="0.15" stroke="#dc2626" strokeWidth={3 * k} />
              )}
              {isSel && <circle cx={pos.x} cy={pos.y} r={12 * k} fill="none" stroke="var(--color-brand)" strokeWidth={3 * k} strokeDasharray={`${4 * k} ${3 * k}`} />}
              {/* A bigger invisible target, easier to tap and drag. */}
              <circle cx={pos.x} cy={pos.y} r={Math.max(r, 12 * k)} fill="transparent" />
              <circle cx={pos.x} cy={pos.y} r={r} fill={isHl ? "var(--color-accent)" : meta.color} stroke="#fff" strokeWidth={2 * k} />
              {reports > 0 && (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={pos.x + 12 * k} cy={pos.y - 12 * k} r={8 * k} fill="#dc2626" stroke="#fff" strokeWidth={1.5 * k} />
                  <text x={pos.x + 12 * k} y={pos.y - 8.5 * k} fontSize={10 * k} fontWeight="700" textAnchor="middle" fill="#fff">{reports}</text>
                </g>
              )}
              {showName
                ? label(pos.x, pos.y - 16 * k, name, isHl ? 14 : 12, isHl ? "#1e2151" : meta.color)
                : !isHl && !isSec && showCodes && p.code
                  ? label(pos.x, pos.y - 9 * k, p.code, 11, meta.color)
                  : null}
            </g>
          );
        })}

        {ghost && (
          <g style={{ pointerEvents: "none" }}>
            <circle cx={ghost.x} cy={ghost.y} r={16 * k} fill="#16a34a" fillOpacity="0.15" stroke="#16a34a" strokeWidth={3 * k} strokeDasharray={`${5 * k} ${4 * k}`} />
            <circle cx={ghost.x} cy={ghost.y} r={6 * k} fill="#16a34a" stroke="#fff" strokeWidth={2 * k} />
            {ghost.label ? label(ghost.x, ghost.y + 30 * k, ghost.label, 12, "#15803d") : null}
          </g>
        )}

        {draftAt && (
          <g data-point={DRAFT} onPointerDown={(e) => onDown(e, DRAFT)} onPointerUp={(e) => onUp(e)} style={onDraftMove ? { cursor: "move" } : undefined}>
            <circle cx={draftAt.x} cy={draftAt.y} r={14 * k} fill="var(--color-brand)" fillOpacity="0.12" stroke="var(--color-brand)" strokeWidth={2 * k} strokeDasharray={`${4 * k} ${3 * k}`} />
            <circle cx={draftAt.x} cy={draftAt.y} r={8 * k} fill="var(--color-brand)" stroke="#fff" strokeWidth={2 * k} />
          </g>
        )}
      </svg>

      {sparse && hidden > 0 && !waiting ? (
        <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface/95 px-3 py-1 text-[11px] font-semibold text-label shadow-sm">
          {t("mapsZoomForPins")}
        </p>
      ) : null}

      {/* Barys waits while the plan image or the pins load. */}
      {waiting ? (
        <div className="absolute inset-0 z-[6] flex flex-col items-center justify-center gap-2 bg-background-2" role="status">
          <div className="absolute inset-3 rounded-xl bg-surface/60 motion-safe:animate-pulse" aria-hidden />
          <div className="relative flex flex-col items-center gap-2">
            <Mascot mood="think" size="md" />
            <p className="text-sm font-semibold text-label">{t("mapsLoadingMap")}</p>
          </div>
        </div>
      ) : null}

      <div className="absolute right-2 top-2 z-[7] flex flex-col gap-1">
        {[
          { label: t("mapsZoomIn"), icon: Plus, run: () => zoom(1 / 1.4) },
          { label: t("mapsZoomOut"), icon: Minus, run: () => zoom(1.4) },
          { label: t("mapsZoomFit"), icon: Maximize2, run: fit },
        ].map(({ label: l, icon: Icon, run }) => (
          <button
            key={l}
            type="button"
            onClick={run}
            aria-label={l}
            title={l}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-primary shadow-sm hover:bg-background-2"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        {controls}
      </div>
    </div>
  );
}
