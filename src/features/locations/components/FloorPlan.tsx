// One floor plan with its points: zoom (buttons, and the wheel where asked),
// drag to pan, click a point or an empty spot, and, in the admin editor,
// drag a point to move it. Everything is drawn in the plan image's own pixels
// (viewBox); clicks are converted with the SVG's screen matrix, so a point's
// position never depends on the screen (see sdu-map-export/README.md).
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FLOORS, PLAN_BLOCKS, TYPE_META, pointLabel, type MapFloor, type MapPoint } from "../mapPoints";

interface View { x: number; y: number; w: number }

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface FloorPlanProps {
  floor: MapFloor;
  /** All points (the plan shows its floor's). */
  points: MapPoint[];
  /** Points to show big, labelled and pulsing (the place you look for). */
  highlight?: string[];
  /** The point being edited (a ring; it can be dragged when onPointMove is given). */
  selectedId?: string;
  /** Points with open "Report a mistake" reports: a red mark and the count. */
  reported?: Record<string, number>;
  /** A block letter to highlight when the room itself is not on the plan yet. */
  block?: string;
  /** Where to look first (zoomed in); changing it moves the view there. */
  focus?: { x: number; y: number; key: string } | null;
  onPointClick?: (p: MapPoint) => void;
  /** A click on the plan itself (not a point), in plan pixels. */
  onPlanClick?: (x: number, y: number) => void;
  /** Dropping a dragged point (only the selected one can be dragged). */
  onPointMove?: (p: MapPoint, x: number, y: number) => void;
  /** Zoom with the mouse wheel (the editor; on the students' page the wheel scrolls the page). */
  wheelZoom?: boolean;
  className?: string;
  /** Extra points not saved yet (a new point in the editor). */
  draft?: { x: number; y: number } | null;
}

export function FloorPlan({
  floor, points, highlight = [], selectedId, reported = {}, block, focus, onPointClick, onPlanClick, onPointMove, wheelZoom, className, draft,
}: FloorPlanProps) {
  const { t } = useLocale();
  const plan = FLOORS[floor];
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });
  const [view, setView] = useState<View>({ x: 0, y: 0, w: plan.w });
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ kind: "pan" | "point"; id?: string; sx: number; sy: number; view: View; moved: boolean } | null>(null);

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
    (x: number, y: number, w = Math.min(plan.w, 1500)) => setView({ x: x - w / 2, y: y - (w * aspect) / 2, w }),
    [plan.w, aspect],
  );

  // A new floor, a new place to look at, or a resized box: frame it again.
  const focusKey = focus ? `${focus.key}@${floor}` : `fit@${floor}`;
  useEffect(() => {
    if (focus) lookAt(focus.x, focus.y);
    else fit();
    // Only when what we look at changes (or the box's shape), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, aspect]);

  const zoom = useCallback(
    (factor: number, cx?: number, cy?: number) =>
      setView((v) => {
        const w = Math.min(Math.max(v.w * factor, 300), plan.w * 1.4);
        const px = cx ?? v.x + v.w / 2;
        const py = cy ?? v.y + (v.w * aspect) / 2;
        const f = w / v.w;
        return { w, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      }),
    [plan.w, aspect],
  );

  const toPlan = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };

  // The wheel zooms only where asked, and must not scroll the page meanwhile.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !wheelZoom) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toPlan(e.clientX, e.clientY);
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [wheelZoom, zoom]);

  const onDown = (e: ReactPointerEvent, point?: MapPoint) => {
    if (e.button !== 0) return;
    const draggable = point && onPointMove && point.id === selectedId;
    gesture.current = { kind: draggable ? "point" : "pan", id: point?.id, sx: e.clientX, sy: e.clientY, view, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };
  const onMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    if (g.kind === "point" && g.id) {
      const p = toPlan(e.clientX, e.clientY);
      setDragPos({ id: g.id, x: p.x, y: p.y });
    } else {
      setView({ ...g.view, x: g.view.x - dx * k, y: g.view.y - dy * k });
    }
  };
  const onUp = (e: ReactPointerEvent, point?: MapPoint) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.moved) {
      if (g.kind === "point" && dragPos && point && onPointMove) {
        const x = Math.min(Math.max(dragPos.x, 0), plan.w);
        const y = Math.min(Math.max(dragPos.y, 0), plan.h);
        onPointMove(point, x, y);
      }
      setDragPos(null);
      return;
    }
    if (point) onPointClick?.(point);
    else if (onPlanClick) {
      const p = toPlan(e.clientX, e.clientY);
      if (p.x >= 0 && p.y >= 0 && p.x <= plan.w && p.y <= plan.h) onPlanClick(p.x, p.y);
    }
  };

  const onFloor = points.filter((p) => p.floor === floor);
  const hl = new Set(highlight);
  // Highlighted and selected points last, so they are drawn on top.
  const ordered = [...onFloor].sort((a, b) => Number(hl.has(a.id) || a.id === selectedId) - Number(hl.has(b.id) || b.id === selectedId));
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

  return (
    <div ref={boxRef} className={cn("relative overflow-hidden rounded-2xl border border-border/60 bg-white", className)}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${vh}`}
        className={cn("block h-full w-full touch-none select-none", onPlanClick ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
        onPointerDown={(e) => onDown(e)}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e)}
        role="img"
        aria-label={t("mapsFloorTab").replace("{floor}", floor)}
      >
        <image href={plan.image} x="0" y="0" width={plan.w} height={plan.h} opacity={plan.faded ? 0.4 : 1} />

        {PLAN_BLOCKS.map((b, i) => (
          <g key={i} style={{ pointerEvents: "none" }}>
            {block === b.block && (
              <circle cx={b.x} cy={b.y} r={Math.max(60, 26 * k)} fill="var(--color-accent)" fillOpacity="0.18" stroke="var(--color-accent)" strokeWidth={4 * k} />
            )}
            <circle cx={b.x} cy={b.y} r={Math.max(30, 13 * k)} fill={block === b.block ? "var(--color-accent)" : "#1e2151"} fillOpacity={block === b.block ? 1 : 0.75} />
            <text x={b.x} y={b.y + Math.max(11, 5 * k)} fontSize={Math.max(32, 14 * k)} fontWeight="700" textAnchor="middle" fill="#fff">{b.block}</text>
          </g>
        ))}

        {ordered.map((p) => {
          const pos = dragPos?.id === p.id ? dragPos : p;
          const meta = TYPE_META[p.type];
          const isHl = hl.has(p.id);
          const isSel = p.id === selectedId;
          const reports = reported[p.id] ?? 0;
          const r = (isHl ? 9 : 5.5) * k;
          return (
            <g
              key={p.id}
              onPointerDown={(e) => onDown(e, p)}
              onPointerUp={(e) => onUp(e, p)}
              className={onPointClick ? "cursor-pointer" : undefined}
              style={onPointMove && isSel ? { cursor: "move" } : undefined}
            >
              <title>{pointLabel(p, t)}</title>
              {isHl && pulse && (
                <circle cx={pos.x} cy={pos.y} r={r} fill="none" stroke="var(--color-accent)" strokeWidth={3 * k}>
                  <animate attributeName="r" values={`${r};${r * 3}`} dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              {reports > 0 && (
                <circle cx={pos.x} cy={pos.y} r={14 * k} fill="#dc2626" fillOpacity="0.15" stroke="#dc2626" strokeWidth={3 * k} />
              )}
              {isSel && <circle cx={pos.x} cy={pos.y} r={12 * k} fill="none" stroke="var(--color-brand)" strokeWidth={3 * k} strokeDasharray={`${4 * k} ${3 * k}`} />}
              {/* A bigger invisible target, easier to click and drag. */}
              <circle cx={pos.x} cy={pos.y} r={Math.max(r, 10 * k)} fill="transparent" />
              <circle cx={pos.x} cy={pos.y} r={r} fill={isHl ? "var(--color-accent)" : meta.color} stroke="#fff" strokeWidth={2 * k} />
              {reports > 0 && (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={pos.x + 12 * k} cy={pos.y - 12 * k} r={8 * k} fill="#dc2626" stroke="#fff" strokeWidth={1.5 * k} />
                  <text x={pos.x + 12 * k} y={pos.y - 8.5 * k} fontSize={10 * k} fontWeight="700" textAnchor="middle" fill="#fff">{reports}</text>
                </g>
              )}
              {isHl
                ? named.has(pointLabel(p, t))
                  ? null
                  : (named.add(pointLabel(p, t)), label(pos.x, pos.y - 16 * k, pointLabel(p, t), 14))
                : showCodes && p.code
                  ? label(pos.x, pos.y - 9 * k, p.code, 11, meta.color)
                  : null}
            </g>
          );
        })}

        {draft && (
          <g style={{ pointerEvents: "none" }}>
            <circle cx={draft.x} cy={draft.y} r={8 * k} fill="var(--color-brand)" stroke="#fff" strokeWidth={2 * k} />
            <circle cx={draft.x} cy={draft.y} r={14 * k} fill="none" stroke="var(--color-brand)" strokeWidth={2 * k} strokeDasharray={`${4 * k} ${3 * k}`} />
          </g>
        )}
      </svg>

      <div className="absolute right-2 top-2 flex flex-col gap-1">
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
      </div>
    </div>
  );
}
