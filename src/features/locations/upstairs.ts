// The walk on an upper floor of a wing: from the elevator, along the wing's
// main corridor (it runs down the middle of the wing, between the left part's
// rooms 01–05 and the right part's 06 and up), to the room. The elevators
// stand in that corridor, and the wings are a little tilted, so the corridor
// is the line through the elevator with the wings' tilt (WING_SLOPE). It is
// drawn as a schematic dashed line, like the floor-1 route.
// Floors 2, 3 and 4 are drawn at the same pixels (floor 1 is another drawing
// and has its own route, campusShapes.ts).
import type { MapFloor, MapPoint } from "./mapPoints";

export interface PlanPt { x: number; y: number }

/**
 * The wings' tilt on the plans (x per y): all six wings stand parallel, and
 * their corridors, traced from the elevators on the floor 3 plan, lean about
 * this much. (Room pins are placed too loosely to measure it from them.)
 */
export const WING_SLOPE = 0.06;

/**
 * Elevator → along the corridor to the room's level → the room. A room past
 * the corridor's ends (the strip under the wing) is reached straight from
 * the elevator. `top` = the corridor's far end (the topmost room of the wing).
 */
export function corridorPath(points: MapPoint[], floor: MapFloor, block: string, lift: PlanPt, room: PlanPt): PlanPt[] {
  const slope = WING_SLOPE;
  const rx = new RegExp(`^${block}${floor}\\d\\d$`, "i");
  const ys = points.filter((p) => p.floor === floor && p.type === "room" && rx.test(p.code)).map((p) => p.y);
  const top = ys.length ? Math.min(...ys) : lift.y - 400;
  const y = Math.min(Math.max(room.y, top), lift.y);
  const turn = { x: lift.x + slope * (y - lift.y), y };
  return Math.hypot(turn.x - lift.x, turn.y - lift.y) < 15 ? [lift, room] : [lift, turn, room];
}
