import { forumKeys } from "@/features/forum/api";
import { apiClient } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** A student's report about a question or an answer (admin panel). */
export interface PostReport {
  id: string;
  reporterName: string;
  targetType: "thread" | "comment";
  targetId: string;
  /** "spam", "rude", "wrong", "other", optionally followed by ": details". */
  reason: string;
  status: "open" | "resolved";
  /** The question's title or the answer's text ("[deleted]" if it's gone). */
  preview: string;
  threadId: string;
  createdAt: string;
}

interface ApiReport {
  id: number;
  reporter_name: string;
  target_type: "thread" | "comment";
  target_id: number;
  reason: string;
  status: "open" | "resolved";
  preview: string;
  thread_id: number;
  created_at: string;
}

const reportKeys = {
  all: ["reports"] as const,
  list: (status: string) => ["reports", status] as const,
};

export function useReports(status: "open" | "resolved", enabled = true) {
  return useQuery({
    queryKey: reportKeys.list(status),
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<{ reports: ApiReport[]; total: number }>("/reports", {
        params: { status, page_size: 50 },
      });
      return {
        total: data.total,
        reports: data.reports.map(
          (r): PostReport => ({
            id: String(r.id),
            reporterName: r.reporter_name,
            targetType: r.target_type,
            targetId: String(r.target_id),
            reason: r.reason,
            status: r.status,
            preview: r.preview,
            threadId: String(r.thread_id),
            createdAt: r.created_at,
          }),
        ),
      };
    },
    refetchInterval: 30_000,
  });
}

/** "Keep it": the post is fine, close the report. */
export function useDismissReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/reports/${id}/resolve`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportKeys.all }),
  });
}

/** "Delete the post": removes it; the backend closes every report about it. */
export function useDeleteReportedPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: PostReport) =>
      apiClient.delete(r.targetType === "thread" ? `/threads/${r.targetId}` : `/comments/${r.targetId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportKeys.all });
      void qc.invalidateQueries({ queryKey: forumKeys.all });
    },
  });
}
