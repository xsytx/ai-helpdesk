// Photos of campus places (Sprint 5, "view location photo"). A place card on
// the Maps page shows the gallery stored under its code; admins manage it in
// the map editor, and a student's "Report a mistake" may carry one photo that
// an admin adds to the gallery.
import { apiClient } from "@/shared/api/client";
import { shrinkImage } from "@/shared/lib/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MapPoint } from "./mapPoints";
import { POINT_PLACE_PREFIX } from "./pointPlaces";
import { PLACES, parseRoomCode, placeForRoom, type Place, type RoomCode } from "./places";

/** Gallery photos per place (same as maxLocationPhotos on the server). */
export const MAX_PLACE_PHOTOS = 12;
/** Caption length (maxLocationPhotoCaption on the server). */
export const MAX_PHOTO_CAPTION = 200;

export interface LocationPhoto {
  id: string;
  placeCode: string;
  url: string;
  caption: string;
}

interface ApiLocationPhoto {
  id: number;
  place_code: string;
  url: string;
  caption: string;
}

const toPhoto = (p: ApiLocationPhoto): LocationPhoto => ({ id: String(p.id), placeCode: p.place_code, url: p.url, caption: p.caption });

const photoKeys = {
  all: ["location-photos"] as const,
  suggestions: ["location-photos", "suggestions"] as const,
  list: (codes: string[]) => ["location-photos", codes.join(",")] as const,
};

const uniq = (codes: (string | undefined)[]) => [...new Set(codes.filter((c): c is string => Boolean(c)))];

/**
 * Where a map point's photos are kept, so the editor and the Maps page agree:
 * its linked place, else the place its room code opens (D117 → HALL_A), else
 * its room code, else "PT_<id>". Then the other codes it may have photos under.
 */
export function photoCodesOfPoint(p: MapPoint): string[] {
  const room = parseRoomCode(p.code);
  const main = p.place || (room && placeForRoom(room.code)?.code) || room?.code || `${POINT_PLACE_PREFIX}${p.id}`;
  return uniq([main, room?.code, `${POINT_PLACE_PREFIX}${p.id}`]);
}

/** At most this many codes per request (maxPhotoCodesPerRequest on the server). */
const MAX_CODES = 10;

/**
 * Every code whose photos belong on the card of `code` (a place code, a room
 * code or "PT_<id>"): the main code first (new photos go there), the card's
 * own code (a report's photo is stored under it), then every other code of
 * the points that card stands for. The Maps page and the editor both use
 * this, so a photo the editor lists is a photo students see.
 */
export function photoCodesOf(code: string, points: MapPoint[]): string[] {
  const related = points.filter((p) => photoCodesOfPoint(p).includes(code));
  const main = related[0] ? photoCodesOfPoint(related[0])[0] : code;
  return uniq([main, code, ...related.flatMap(photoCodesOfPoint)]).slice(0, MAX_CODES);
}

/** The codes a Maps place card shows photos of (see photoCodesOf). */
export function photoCodesOfTarget(target: Place | RoomCode, points: MapPoint[]): string[] {
  return photoCodesOf(target.code, points);
}

/** A place's gallery (photos of all these codes, in the admins' order). */
export function useLocationPhotos(codes: string[]) {
  return useQuery({
    queryKey: photoKeys.list(codes),
    enabled: codes.length > 0,
    queryFn: async () => {
      const { data } = await apiClient.get<{ photos: ApiLocationPhoto[] }>("/map/photos", { params: { codes: codes.join(",") } });
      return data.photos.map(toPhoto);
    },
  });
}

/** Admin: add a photo to a place's gallery (shrunk in the browser first, like forum photos). */
export function useUploadLocationPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ placeCode, file, caption = "" }: { placeCode: string; file: File; caption?: string }) => {
      const form = new FormData();
      form.append("place_code", placeCode);
      form.append("caption", caption);
      form.append("file", await shrinkImage(file));
      const { data } = await apiClient.post<ApiLocationPhoto>("/admin/map/photos", form, { headers: { "Content-Type": "multipart/form-data" } });
      return toPhoto(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: photoKeys.all }),
  });
}

export function useUpdatePhotoCaption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, caption }: { id: string; caption: string }) => {
      const { data } = await apiClient.patch<ApiLocationPhoto>(`/admin/map/photos/${id}`, { caption });
      return toPhoto(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: photoKeys.all }),
  });
}

/** Admin: the place's gallery in a new order (every photo of that code, once). */
export function useReorderLocationPhotos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ placeCode, ids }: { placeCode: string; ids: string[] }) => {
      await apiClient.put("/admin/map/photos/order", { place_code: placeCode, ids: ids.map(Number) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: photoKeys.all }),
  });
}

/** Admin: delete a gallery photo or a report's photo. */
export function useDeleteLocationPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/map/photos/${id}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: photoKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["location-reports"] });
    },
  });
}

/** Admin: a student's report photo goes into the place's gallery. */
export function useApproveLocationPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, caption = "" }: { id: string; caption?: string }) => {
      const { data } = await apiClient.post<ApiLocationPhoto>(`/admin/map/photos/${id}/approve`, { caption });
      return toPhoto(data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: photoKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["location-reports"] });
    },
  });
}

/** Student: attach a photo to the report just sent (waits for an admin). */
export async function uploadReportPhoto(reportId: string, file: File) {
  const form = new FormData();
  form.append("file", await shrinkImage(file));
  await apiClient.post(`/location-reports/${reportId}/photo`, form, { headers: { "Content-Type": "multipart/form-data" } });
}

/** Student: offer a photo of a place; it shows after an admin adds it to the gallery. */
export function useSuggestLocationPhoto() {
  return useMutation({
    mutationFn: async ({ placeCode, file }: { placeCode: string; file: File }) => {
      const form = new FormData();
      form.append("place_code", placeCode);
      form.append("file", await shrinkImage(file));
      await apiClient.post("/location-photos", form, { headers: { "Content-Type": "multipart/form-data" } });
    },
  });
}

export interface PhotoSuggestion extends LocationPhoto {
  uploaderName: string;
  createdAt: string;
}

/** Admin: students' photos waiting for a check (approve / delete them like report photos). */
export function usePhotoSuggestions() {
  return useQuery({
    queryKey: photoKeys.suggestions,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await apiClient.get<{ photos: (ApiLocationPhoto & { uploader_name: string; created_at: string })[] }>("/admin/map/photos/suggestions");
      return data.photos.map((p): PhotoSuggestion => ({ ...toPhoto(p), uploaderName: p.uploader_name, createdAt: p.created_at }));
    },
  });
}

/**
 * Bulk upload: which place a photo belongs to, from its file name.
 * "F205.jpg", "f205-2.jpg", "F205 (3).jpeg" → room F205 (or the place it
 * opens / its point's place, like a single upload); "RED_CANTEEN.jpg" → that
 * place; a map point's own code ("LIB1.jpg") → that point. null = no match.
 */
export function bulkPhotoTarget(fileName: string, points: MapPoint[]): { code: string; label: string } | null {
  const name = fileName.replace(/\.[^.]+$/, "").trim();
  // A number after the code tells photos of one room apart: "-2", "_2", " 2", " (2)".
  const base = (/^(.+?)(?:\s*\(\d+\)|[\s_-]+\d{1,2})$/.exec(name)?.[1] ?? name).trim();
  for (const candidate of base === name ? [name] : [base, name]) {
    const upper = candidate.toUpperCase();
    const room = parseRoomCode(candidate);
    if (room) {
      const point = points.find((p) => p.code.toUpperCase() === room.code);
      return { code: point ? photoCodesOfPoint(point)[0]! : (placeForRoom(room.code)?.code ?? room.code), label: room.code };
    }
    const place = PLACES.find((p) => p.code === upper);
    if (place) return { code: place.code, label: place.code };
    const point = points.find((p) => p.code && p.code.toUpperCase() === upper);
    if (point) return { code: photoCodesOfPoint(point)[0]!, label: point.code };
  }
  return null;
}
