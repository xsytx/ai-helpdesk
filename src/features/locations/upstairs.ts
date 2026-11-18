// The walk on an upper floor of a wing, from the elevator to the room.
//
// Down the middle of each wing is a void (open to the floors below, like a
// balcony): nobody walks there. The corridors run along both sides of it,
// the left one by the left part's rooms (01–05) and the right one by the
// right part's (06 and up). The elevators stand at the void's lower end and
// open to the left on floors 1, 2 and 3B, to the right on 3A and 4 (the
// user's description, 2026-11-19). So: out of the elevator to that side's
// corridor, along it to the room's level, into the room; a room on the other
// side is reached across the void's lower end, where the wing meets the hall.
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

/** Which way the elevator opens on a level ("2", "3A", "3B", "4"). */
export function liftExit(level: string | undefined): Side | undefined {
  if (level === "2" || level === "3B") return "left";
  if (level === "3A" || level === "4") return "right";
  return undefined;
}

/**
 * Elevator → its door side's corridor → along it (crossing at the void's
 * lower end if the room is on the other side) → the room. `roomNo` is the
 * room's two digits ("07"), if known; rooms 13 and up are in the strip under
 * the wing, reached straight from the elevator.
 */
export function corridorPath(
  points: MapPoint[], floor: MapFloor, block: string, lift: PlanPt, room: PlanPt, level?: string, roomNo?: string,
): PlanPt[] {
  const offsets = CORRIDOR[floor === "2" ? "2" : "3"][block];
  const n = roomNo !== undefined ? Number(roomNo) : NaN;
  if (!offsets || n >= 13) return [lift, room];
  const centre = (y: number) => lift.x + WING_SLOPE * (y - lift.y);
  const at = (side: Side, y: number): PlanPt => ({ x: centre(y) + offsets[side === "left" ? 0 : 1], y });
  // The room's side: by its number, else by where its pin is.
  const roomSide: Side = !Number.isNaN(n) ? (n <= 5 ? "left" : "right") : room.x < centre(room.y) ? "left" : "right";
  const exit = liftExit(level) ?? roomSide;
  // How far up the corridor goes: to the wing's topmost room on this floor.
  const rx = new RegExp(`^${block}${floor}\\d\\d$`, "i");
  const ys = points.filter((p) => p.floor === floor && p.type === "room" && rx.test(p.code)).map((p) => p.y);
  const top = ys.length ? Math.min(...ys) : lift.y - 400;
  const y = Math.min(Math.max(room.y, top), lift.y);

  const path: PlanPt[] = [lift, at(exit, lift.y)];
  if (exit !== roomSide) {
    // Round the void's lower end, just below the elevator.
    const below = lift.y + 30;
    path.push(at(exit, below), at(roomSide, below), at(roomSide, lift.y));
  }
  path.push(at(roomSide, y), room);
  return path;
}
