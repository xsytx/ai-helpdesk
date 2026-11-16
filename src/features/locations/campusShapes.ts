// The shapes of the campus drawn over the 1st-floor plan: block outlines and
// colours, block letters, the lecture halls ("bochkas"), the canteen and the
// medical point. They were traced in "scheme units" = the plan image's pixels
// divided by PLAN_SCALE (plus a small offset); `UNIT_TO_PLAN` turns them into
// plan pixels, so the same shapes sit on the floor plan (FloorPlan) and on the
// route scheme (CampusScheme).
import type { SchemeBlock } from "./places";

export type Pt = [number, number];
export interface Box { x: number; y: number; w: number; h: number }

/**
 * The full plan image (4818 × 1689 px) in scheme units: plan pixel = PLAN_SCALE
 * × scheme unit + offset, measured on six wing passages and the lecture halls.
 * Room points (map_points) use plan pixels; this scheme uses the units.
 */
export const PLAN_SCALE = 2.3653;
export const PLAN_X = 0.6 / PLAN_SCALE;
export const PLAN_Y = -2 / PLAN_SCALE;
export const PLAN_W = 4818 / PLAN_SCALE;
export const PLAN_H = 1689 / PLAN_SCALE;
/** The drawing area: wide enough for the east wall and Entrance I. */
export const W = 2040;
export const H = 714;

/** One colour per block, as on the campus map. */
export const COLOR: Record<SchemeBlock, string> = {
  A: "#c95a4f", B: "#b8975a", C: "#3f8a73", D: "#8a4aa8", E: "#9b3a3e",
  F: "#3d4a96", G: "#5f8a3f", H: "#3b6fb5", I: "#e07a1a",
};

export const box = (x1: number, y1: number, x2: number, y2: number): Box => ({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
export const BLOCKS: Record<SchemeBlock, Box[]> = {
  A: [box(100, 35, 335, 180)],
  B: [box(30, 182, 302, 408)],
  C: [box(180, 412, 425, 675)],
  D: [box(466, 175, 607, 410)],
  E: [box(738, 175, 887, 410)],
  F: [box(986, 175, 1137, 410)],
  G: [box(1261, 175, 1402, 410), box(1255, 458, 1475, 685)],
  H: [box(1541, 175, 1687, 410), box(1476, 468, 1720, 625)],
  I: [box(1811, 175, 1968, 410)],
};
/** Where each block's letter badge sits. */
export const BADGE: Record<SchemeBlock, Pt> = {
  A: [70, 108], B: [58, 352], C: [138, 560],
  D: [536, 140], E: [812, 140], F: [1061, 140], G: [1331, 140], H: [1614, 140], I: [1889, 140],
};

export const HALLS: Record<"A" | "B" | "C" | "D", { cx: number; cy: number; r: number }> = {
  A: { cx: 484, cy: 550, r: 53 },
  B: { cx: 577, cy: 497, r: 38 },
  C: { cx: 685, cy: 550, r: 51 },
  D: { cx: 830, cy: 500, r: 39 },
};
export const CANTEEN = box(962, 462, 1205, 610);
export const MED: Pt = [1447, 392];

/** An SVG transform from scheme units to plan pixels (floor-plan coordinates). */
export const UNIT_TO_PLAN = `matrix(${PLAN_SCALE} 0 0 ${PLAN_SCALE} -0.6 2)`;
/** A plan pixel in scheme units (the inverse of UNIT_TO_PLAN). */
export const planToUnit = (x: number, y: number): Pt => [(x + 0.6) / PLAN_SCALE, (y - 2) / PLAN_SCALE];

const inBox = (b: Box, [x, y]: Pt) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
const inCircle = (cx: number, cy: number, r: number, [x, y]: Pt) => Math.hypot(x - cx, y - cy) <= r;

/**
 * The clickable place at a spot of the plan (plan pixels), as a code of
 * places.ts: a lecture hall, the medical point, the canteen or a block.
 * Small places win over the block around them.
 */
export function placeAtPlan(x: number, y: number): string | undefined {
  const u = planToUnit(x, y);
  for (const [key, h] of Object.entries(HALLS)) if (inCircle(h.cx, h.cy, h.r, u)) return `HALL_${key}`;
  if (inCircle(MED[0], MED[1], 30, u)) return "MEDICAL";
  if (inBox(CANTEEN, u)) return "RED_CANTEEN";
  // A block's letter badge (several sit just outside the block's outline).
  for (const [key, [bx, by]] of Object.entries(BADGE)) if (inCircle(bx, by, 30, u)) return `BLOCK_${key}`;
  for (const [key, boxes] of Object.entries(BLOCKS)) if (boxes.some((b) => inBox(b, u))) return `BLOCK_${key}`;
  return undefined;
}
