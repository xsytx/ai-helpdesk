import { useAuth } from "@/app/AuthContext";
import { forumKeys } from "@/features/forum/api";
import { apiClient, USE_MOCK_API } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModerationDecision } from "./notice";

// --- Moderators' queue ---

export type QueueStatus = "pending" | "approved" | "rejected" | "all";

/** Optional date range for the moderation log (YYYY-MM-DD, both inclusive). */
export interface QueueDateRange {
  from?: string;
  to?: string;
}

/** "new" = newest first, "old" = oldest first. */
export type QueueSort = "new" | "old";

export interface ModerationItem {
  id: number;
  kind: "thread" | "comment";
  authorName: string;
  title: string;
  body: string;
  tags: string[];
  threadId?: number;
  threadTitle?: string;
  decision: ModerationDecision;
  categories: string[];
  reason: string;
  status: QueueStatus;
  reviewerName?: string;
  reviewedAt?: string;
  adminNote: string;
  publishedThreadId?: number;
  publishedCommentId?: number;
  /** Published first, then hidden by the AI (false: stopped before publishing). */
  hiddenAfterPublish: boolean;
  createdAt: string;
}

interface ApiModerationItem {
  id: number;
  kind: "thread" | "comment";
  author_name: string;
  title: string;
  body: string;
  tags: string[] | null;
  thread_id?: number;
  thread_title?: string;
  decision: ModerationDecision;
  categories: string[] | null;
  reason: string;
  status: QueueStatus;
  reviewer_name?: string;
  reviewed_at?: string;
  admin_note: string;
  published_thread_id?: number;
  published_comment_id?: number;
  hidden_after_publish?: boolean;
  created_at: string;
}

interface ApiQueue {
  items: ApiModerationItem[];
  total: number;
  pending: number;
}

function toItem(i: ApiModerationItem): ModerationItem {
  return {
    id: i.id,
    kind: i.kind,
    authorName: i.author_name,
    title: i.title,
    body: i.body,
    tags: i.tags ?? [],
    threadId: i.thread_id,
    threadTitle: i.thread_title,
    decision: i.decision,
    categories: i.categories ?? [],
    reason: i.reason,
    status: i.status,
    reviewerName: i.reviewer_name,
    reviewedAt: i.reviewed_at,
    adminNote: i.admin_note,
    publishedThreadId: i.published_thread_id,
    publishedCommentId: i.published_comment_id,
    hiddenAfterPublish: i.hidden_after_publish ?? false,
    createdAt: i.created_at,
  };
}

export const moderationKeys = {
  all: ["moderation"] as const,
  queue: (status: QueueStatus, range: QueueDateRange, sort: QueueSort) =>
    [...moderationKeys.all, "queue", status, range.from ?? "", range.to ?? "", sort] as const,
  pending: ["moderation", "pending-count"] as const,
};

export function isStaffRole(role: string | undefined): boolean {
  return role === "moderator" || role === "admin";
}

export function useModerationQueue(status: QueueStatus, range: QueueDateRange = {}, sort: QueueSort = "new") {
  const { user } = useAuth();
  return useQuery({
    queryKey: moderationKeys.queue(status, range, sort),
    enabled: isStaffRole(user?.role) && !USE_MOCK_API,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiQueue>("/moderation/queue", {
        params: { status, sort, page_size: 50, from: range.from || undefined, to: range.to || undefined },
      });
      return { items: data.items.map(toItem), total: data.total, pending: data.pending };
    },
  });
}

/** Number of posts waiting for a decision — for the badge in the menu. Only fetched for moderators/admins. */
export function usePendingModerationCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: moderationKeys.pending,
    enabled: isStaffRole(user?.role) && !USE_MOCK_API,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiQueue>("/moderation/queue", {
        params: { status: "pending", page_size: 1 },
      });
      return data.pending;
    },
  });
}

export function useReviewModerationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; action: "approve" | "reject"; note: string }) => {
      const { data } = await apiClient.post<ApiModerationItem>(
        `/moderation/queue/${input.id}/${input.action}`,
        { note: input.note },
      );
      return toItem(data);
    },
    onSuccess: (_item, vars) => {
      void qc.invalidateQueries({ queryKey: moderationKeys.all });
      // An approved post is now a real thread/answer: refresh the forum too.
      if (vars.action === "approve") void qc.invalidateQueries({ queryKey: forumKeys.all });
    },
  });
}
