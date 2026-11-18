// The walk on an upper floor of a wing, from the elevator to the room.
//
// Down the middle of each wing is a void (open to the floors below, like a
// balcony): nobody walks there. The corridors run along both sides of it,
// the left one by the left part's rooms (01–05) and the right one by the
// right part's (06 and up). The elevators stand at the void's lower end and
// can be left on either side (the user, 2026-11-19): out of the elevator to
// the room's side, along that corridor to the room's level, into the room.
// The side: 3A and 4 are the right part, 3B the left part (whatever the room
// number: floor 4's rooms are 401–407, all on the right); on floor 2 rooms
// 01–05 are on the left and 06 and up on the right.
//
// The void's centre is the line through the elevator with the wings' tilt;
// the corridors' offsets from it were measured on the plan images (floors
// 3 and 4 share one drawing; floors 2–4 are drawn at the same pixels; floor
// 1 is another drawing with its own route, campusShapes.ts).
import type { MapFloor, MapPoint } from "./mapPoints";

export interface PlanPt { x: number; y: number }
type Side = "left" | "right";

/** The wings' tilt on the plans (x per y): all six wings stand parallel. */
export const WING_SLOPE = 0.06;

/** Each corridor's centre, in plan pixels from the void's centre line, per floor and wing. */
const CORRIDOR: Record<"2" | "3", Record<string, [number, number]>> = {
  "2": { D: [-38, 27], E: [-38, 26], F: [-43, 27], G: [-38, 34], H: [-27, 29], I: [-27, 13] },
  "3": { D: [-32, 43], E: [-31, 44], F: [-44, 29], G: [-39, 34], H: [-27, 32], I: [-28, 31] },
};

/** The side a level is on: 3B the left part, 3A and 4 the right part (floor 2 has both). */
export function levelSide(level: string | undefined): Side | undefined {
  if (level === "3B") return "left";
  if (level === "3A" || level === "4") return "right";
  return undefined;
}

/** How far from the void's centre line a room pin may be to count as along the corridor. */
const BESIDE = 170;

/**
 * Elevator → the corridor on the room's side → along it → the room, or null
 * when the room isn't beside the wing's corridor (the strip under a wing,
 * the hall below block I, a floor-2 room 12 off to the side): no line is
 * drawn then, rather than one through walls; the elevator and the room
 * stay marked. `roomNo` is the room's two digits ("07"), if known.
 */
export function corridorPath(
  points: MapPoint[], floor: MapFloor, block: string, lift: PlanPt, room: PlanPt, level?: string, roomNo?: string,
): PlanPt[] | null {
  const offsets = CORRIDOR[floor === "2" ? "2" : "3"][block];
  const n = roomNo !== undefined ? Number(roomNo) : NaN;
  const centre = (y: number) => lift.x + WING_SLOPE * (y - lift.y);
  if (!offsets || room.y > lift.y + 40 || Math.abs(room.x - centre(room.y)) > BESIDE) return null;
  const at = (side: Side, y: number): PlanPt => ({ x: centre(y) + offsets[side === "left" ? 0 : 1], y });
  // The room's side: by its level, else (floor 2) by its number, else by where its pin is.
  const side: Side = levelSide(level) ?? (!Number.isNaN(n) ? (n <= 5 ? "left" : "right") : room.x < centre(room.y) ? "left" : "right");
  // How far up the corridor goes: to the wing's topmost room on this floor.
  const rx = new RegExp(`^${block}${floor}\\d\\d$`, "i");
  const ys = points.filter((p) => p.floor === floor && p.type === "room" && rx.test(p.code)).map((p) => p.y);
  const top = ys.length ? Math.min(...ys) : lift.y - 400;
  const y = Math.min(Math.max(room.y, top), lift.y);

  return [lift, at(side, lift.y), at(side, y), room];
}
