// Points on the floor plans (Sprint 5): rooms, stairs, toilets, entrances and
// services, stored on the server (map_points). Students see them on the Maps
// page; admins move, rename, add and delete them in the admin panel's map
// editor, so a fix there reaches every student on their next visit.
// x, y are pixels of the plan image (origin top-left), never screen pixels.
import { apiClient } from "@/shared/api/client";
import type { TranslationKey } from "@/i18n/translations";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type MapFloor = "1" | "2" | "3B" | "3";

/** The plan image of each floor and its size in pixels (do not resize the images: points would shift). */
export const FLOORS: Record<MapFloor, { image: string; w: number; h: number; faded?: boolean }> = {
  "1": { image: "/maps/floor1.png", w: 4818, h: 1689 },
  "2": { image: "/maps/floor2.png", w: 4728, h: 1689 },
  // The half-floor between 2 and 3 has no plan of its own yet: floor 3's, faded.
  "3B": { image: "/maps/floor3.png", w: 4728, h: 1689, faded: true },
  "3": { image: "/maps/floor3.png", w: 4728, h: 1689 },
};
export const FLOOR_ORDER: MapFloor[] = ["1", "2", "3B", "3"];

/** Same list as store.MapPointTypes on the server. */
export const POINT_TYPES = [
  "room", "lab", "office", "hall", "library", "canteen", "cafe", "shop", "medical", "service",
  "wifi", "toilet", "staff_toilet", "stairs", "elevator", "entrance", "other",
] as const;
export type PointType = (typeof POINT_TYPES)[number];

export const TYPE_META: Record<PointType, { color: string; key: TranslationKey }> = {
  room: { color: "#e8590c", key: "mapTypeRoom" },
  lab: { color: "#1c7ed6", key: "mapTypeLab" },
  office: { color: "#9c36b5", key: "mapTypeOffice" },
  hall: { color: "#d97706", key: "mapTypeHall" },
  library: { color: "#7c3aed", key: "mapTypeLibrary" },
  canteen: { color: "#0369a1", key: "mapTypeCanteen" },
  cafe: { color: "#0e7490", key: "mapTypeCafe" },
  shop: { color: "#0f766e", key: "mapTypeShop" },
  medical: { color: "#dc2626", key: "mapTypeMedical" },
  service: { color: "#a83524", key: "mapTypeService" },
  wifi: { color: "#64748b", key: "mapTypeWifi" },
  toilet: { color: "#0ca678", key: "mapTypeToilet" },
  staff_toilet: { color: "#289da4", key: "mapTypeStaffToilet" },
  stairs: { color: "#495057", key: "mapTypeStairs" },
  elevator: { color: "#5c7cfa", key: "mapTypeElevator" },
  entrance: { color: "#c92a2a", key: "mapTypeEntrance" },
  other: { color: "#868e96", key: "mapTypeOther" },
};

/** Block letters on the plans (the same on every floor: the wings stand one above another). */
export const PLAN_BLOCKS: { block: string; x: number; y: number }[] = [
  { block: "A", x: 150, y: 170 }, { block: "B", x: 110, y: 700 }, { block: "C", x: 330, y: 1300 },
  { block: "D", x: 1280, y: 250 }, { block: "E", x: 1920, y: 250 }, { block: "F", x: 2507, y: 250 },
  { block: "G", x: 3157, y: 250 }, { block: "H", x: 3820, y: 250 }, { block: "I", x: 4457, y: 250 },
  { block: "G", x: 3235, y: 1360 }, { block: "H", x: 3790, y: 1240 },
];

export interface MapPoint {
  id: string;
  /** Room code as students type it ("F205"), or "". */
  code: string;
  name: string;
  type: PointType;
  floor: MapFloor;
  x: number;
  y: number;
  /** The Maps page place it belongs to ("RED_CANTEEN", "HALL_A"), or "". */
  place: string;
}
export type MapPointDraft = Omit<MapPoint, "id">;

interface ApiMapPoint extends MapPointDraft {
  id: number;
}

const toPoint = (p: ApiMapPoint): MapPoint => ({ ...p, id: String(p.id) });

export const mapPointKeys = { all: ["map-points"] as const };

/** Every point; refetched on each visit, so students see an admin's change. */
export function useMapPoints() {
  return useQuery({
    queryKey: mapPointKeys.all,
    queryFn: async () => {
      const { data } = await apiClient.get<{ points: ApiMapPoint[] }>("/map/points");
      return data.points.map(toPoint);
    },
    staleTime: 0,
  });
}

/** Create (no id) or replace (with id) a point. */
export function useSaveMapPoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...draft }: MapPointDraft & { id?: string }) => {
      const { data } = id
        ? await apiClient.put<ApiMapPoint>(`/admin/map/points/${id}`, draft)
        : await apiClient.post<ApiMapPoint>("/admin/map/points", draft);
      return toPoint(data);
    },
    // Show the saved point at once (a moved pin must not jump back while the list reloads).
    onSuccess: (saved) =>
      qc.setQueryData<MapPoint[]>(mapPointKeys.all, (old) =>
        old ? (old.some((p) => p.id === saved.id) ? old.map((p) => (p.id === saved.id ? saved : p)) : [...old, saved]) : old,
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: mapPointKeys.all }),
  });
}

export function useDeleteMapPoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/map/points/${id}`);
      return id;
    },
    onSuccess: (id) => qc.setQueryData<MapPoint[]>(mapPointKeys.all, (old) => old?.filter((p) => p.id !== id)),
    onSettled: () => qc.invalidateQueries({ queryKey: mapPointKeys.all }),
  });
}

const sameCode = (a: string, b: string) => a.replace(/\s+/g, "").toUpperCase() === b.replace(/\s+/g, "").toUpperCase();

/**
 * The points a Maps page target stands for: a room code ("F205") or a place
 * code ("RED_CANTEEN", "HALL_A"; also a place's own room codes like D117).
 */
export function pointsFor(points: MapPoint[], code: string, roomCodes: string[] = []): MapPoint[] {
  if (!code) return [];
  return points.filter(
    (p) => (p.code && (sameCode(p.code, code) || roomCodes.some((r) => sameCode(p.code, r)))) || (p.place && p.place === code),
  );
}

/** The label shown for a point: its name, else its code, else its type. */
export function pointLabel(p: MapPoint, t: (k: TranslationKey) => string): string {
  return p.name || p.code || t(TYPE_META[p.type].key);
}

/** A room code's floor as a plan ("F205" → "2"), if there is a plan for it. */
export function floorOfRoom(floor: number | undefined): MapFloor | undefined {
  return floor === 1 || floor === 2 || floor === 3 ? (String(floor) as MapFloor) : undefined;
}
