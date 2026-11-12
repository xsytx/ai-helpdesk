// "Report a mistake" on the campus navigation page: students report a wrong
// route or position; admins mark reports fixed or rejected (Sprint 5).
import { apiClient } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MapFloor } from "./mapPoints";
import type { Entrance } from "./places";

/** A spot on a floor plan, in plan pixels ("it's actually here"). */
export interface MapSpot {
  floor: MapFloor;
  x: number;
  y: number;
}

export type LocationReportStatus = "open" | "fixed" | "rejected";

export interface LocationReport {
  id: string;
  reporterName: string;
  /** A place code ("BLOCK_F", "HALL_B") or a room code ("F205"). */
  placeCode: string;
  placeName: string;
  entrance: Entrance | "";
  text: string;
  status: LocationReportStatus;
  createdAt: string;
  /** Where the student says it really is, if they tapped the plan. */
  suggested?: MapSpot;
  /** The photo the student attached: waiting for an admin, or added to the gallery. */
  photo?: ReportPhoto;
}

export interface ReportPhoto {
  id: string;
  url: string;
  status: "pending" | "approved";
}

interface ApiLocationReport {
  id: number;
  reporter_name: string;
  place_code: string;
  place_name: string;
  entrance: Entrance | "";
  text: string;
  status: LocationReportStatus;
  created_at: string;
  suggested?: MapSpot | null;
  photo?: { id: number; url: string; status: ReportPhoto["status"] } | null;
}

const toReport = (r: ApiLocationReport): LocationReport => ({
  id: String(r.id),
  reporterName: r.reporter_name,
  placeCode: r.place_code,
  placeName: r.place_name,
  entrance: r.entrance,
  text: r.text,
  status: r.status,
  createdAt: r.created_at,
  suggested: r.suggested ?? undefined,
  photo: r.photo ? { ...r.photo, id: String(r.photo.id) } : undefined,
});

const locationReportKeys = {
  all: ["location-reports"] as const,
  list: (status: LocationReportStatus) => ["location-reports", status] as const,
};

export function useReportLocation() {
  return useMutation({
    mutationFn: async (input: { placeCode: string; placeName: string; entrance: Entrance; text: string; suggested?: MapSpot }) => {
      const { data } = await apiClient.post<ApiLocationReport>("/location-reports", {
        place_code: input.placeCode,
        place_name: input.placeName,
        entrance: input.entrance,
        text: input.text,
        ...(input.suggested ? { suggested: input.suggested } : {}),
      });
      return toReport(data);
    },
  });
}

export function useLocationReports(status: LocationReportStatus, enabled = true) {
  return useQuery({
    queryKey: locationReportKeys.list(status),
    enabled,
    // The admin tab badge and the editor's red marks stay current.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data } = await apiClient.get<{ reports: ApiLocationReport[] }>("/admin/location-reports", { params: { status } });
      return data.reports.map(toReport);
    },
  });
}

export function useSetLocationReportStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: LocationReportStatus }) => {
      const { data } = await apiClient.patch<ApiLocationReport>(`/admin/location-reports/${id}`, { status });
      return toReport(data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: locationReportKeys.all }),
  });
}
