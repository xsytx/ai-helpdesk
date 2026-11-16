// The shapes of the campus drawn over the 1st-floor plan: block outlines and
// colours, block letters, the lecture halls ("bochkas"), the canteen and the
// medical point. They were traced in "scheme units" = the plan image's pixels
// divided by PLAN_SCALE (plus a small offset); `UNIT_TO_PLAN` turns them into
// plan pixels, so they sit on the floor plan (CampusLayer inside FloorPlan),
// together with the walkways and routes below.
import type { Entrance, SchemeBlock, SchemeSpot } from "./places";

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

// Walkways, traced on the plan image. The wings' bottom strip (y 370–415)
// holds rooms (toilets, shop, medical point), so routes never run along it:
// the walkway is the hall just below it (HALL_Y), and each wing is entered
// through its passage between its two stairwells (WING_DOOR_X).
export const HALL_Y = 447;
/** East of the H passage the hall runs a little lower, below the stairs in it. */
export const HALL_Y_EAST = 458;
export const HALL_EAST_FROM = 1570;
export const hallY = (x: number) => (x >= HALL_EAST_FROM ? HALL_Y_EAST : HALL_Y);

/** The passage up into each wing (between the wing's two stairwells). */
export const WING_DOOR_X: Partial<Record<SchemeBlock, number>> = { D: 552, E: 824, F: 1074, G: 1350, H: 1628, I: 1899 };
/** How far up the wing's own corridor the route goes. */
export const WING_END_Y = 300;

/** Atrium side: from the C entrance hall up to the hall (west end of the walkway). */
export const C_TO_HALL: Pt[] = [[262, 612], [300, 578], [350, 505], [368, 496], [400, 478], [425, HALL_Y]];
/** From the gap east of the atrium to block B's hall (through the atrium's north side and its glass door). */
export const ATRIUM_TO_B: Pt[] = [[338, 483], [322, 452], [275, 430], [250, 417], [225, 395], [205, 330]];

/** Each entrance and the way from it to the walkway. */
export const ENTRANCES: Record<Entrance, { at: Pt; toHall: Pt[] }> = {
  // Main entrance: the glass entrance hall of block C, then past the atrium.
  C: { at: [228, 650], toHall: C_TO_HALL },
  // Through the G building to the hall.
  G: { at: [1316, 656], toHall: [[1312, 615], [1343, 560], [1343, 470], [1343, HALL_Y]] },
  // East entrance: on the east wall of the big hall under blocks H and I.
  I: { at: [1995, 469], toHall: [[1960, HALL_Y_EAST]] },
};

/** Along the walkway from x1 to x2 (a step down to the lower eastern part on the way). */
export function alongHall(x1: number, x2: number): Pt[] {
  const out: Pt[] = [];
  const east = HALL_EAST_FROM;
  if (x1 < east && x2 >= east) out.push([east - 15, HALL_Y], [east + 15, HALL_Y_EAST]);
  if (x1 >= east && x2 < east) out.push([east + 15, HALL_Y_EAST], [east - 15, HALL_Y]);
  out.push([x2, hallY(x2)]);
  return out;
}

/** The route from an entrance to the place, along walkable space only. */
export function routePoints(from: Entrance, block?: SchemeBlock, spot?: SchemeSpot): Pt[] | null {
  const { at, toHall } = ENTRANCES[from];
  const hallStart = toHall[toHall.length - 1];
  /** From the entrance along the walkway to x. */
  const toX = (x: number): Pt[] => [at, ...toHall, ...alongHall(hallStart[0], x)];
  /** To the gap east of the atrium (where the ways to blocks A, B and C start). */
  const toAtrium = (): Pt[] =>
    from === "C" ? [at, ...C_TO_HALL.slice(0, 3)] : [...toX(425), [400, 478], [368, 496], [350, 505]];

  if (spot?.startsWith("hall")) {
    const h = HALLS[spot.slice(4) as keyof typeof HALLS];
    return [...toX(h.cx), [h.cx, h.cy - h.r]];
  }
  // The canteen's door is on its north side, towards the walkway.
  if (spot === "canteen") return [...toX(1032), [1032, 500]];
  if (spot === "med") return [...toX(MED[0]), [MED[0], MED[1] + 6]];
  if (!block) return null;

  if (block === "H") {
    // The hall's stairs sit right under H's passage: go round them on the west.
    const door = WING_DOOR_X.H!;
    return [...toX(1600), [1620, 425], [door, 410], [door, WING_END_Y]];
  }
  const door = WING_DOOR_X[block];
  if (door !== undefined) return [...toX(door), [door, 412], [door, WING_END_Y]];

  if (block === "C") return from === "C" ? [at, [262, 612], [300, 578], [318, 560]] : [...toAtrium(), [318, 560]];
  if (block === "B") return [...toAtrium(), ...ATRIUM_TO_B];
  // Block A: through block B's hall and north to the A building.
  return [...toAtrium(), ...ATRIUM_TO_B, [200, 230], [215, 115]];
}

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
