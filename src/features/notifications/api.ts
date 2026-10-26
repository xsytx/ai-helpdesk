import { useAuth } from "@/app/AuthContext";
import { apiClient, USE_MOCK_API } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Someone answered in a thread you follow (yours, or one you answered in), or replied to your answer. */
export interface AppNotification {
  id: string;
  type: "comment_on_thread" | "reply_to_comment" | "mention" | "answer_liked" | "answer_accepted";
  threadId: string;
  threadTitle: string;
  actorName: string;
  read: boolean;
  createdAt: string;
}

interface ApiNotification {
  id: number;
  type: AppNotification["type"];
  thread_id: number;
  thread_title: string;
  actor_name: string;
  read: boolean;
  created_at: string;
}

const keys = {
  all: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  list: ["notifications", "list"] as const,
};

/** The badge polls this light endpoint; paused in background tabs. */
const UNREAD_REFRESH_MS = 30_000;

export function useUnreadNotificationCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.unread,
    enabled: Boolean(user) && !USE_MOCK_API,
    queryFn: async () => {
      const { data } = await apiClient.get<{ unread: number }>("/notifications/unread-count");
      return data.unread;
    },
    refetchInterval: UNREAD_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/** The newest notifications; loaded when the bell is opened. */
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: keys.list,
    enabled: enabled && !USE_MOCK_API,
    staleTime: 0,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data } = await apiClient.get<{ notifications: ApiNotification[] }>("/notifications", {
        params: { page_size: 20 },
      });
      return data.notifications.map((n) => ({
        id: String(n.id),
        type: n.type,
        threadId: String(n.thread_id),
        threadTitle: n.thread_title,
        actorName: n.actor_name,
        read: n.read,
        createdAt: n.created_at,
      }));
    },
  });
}

function useMarkRead(request: (id?: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    // Shown as read at once; the badge and list are corrected by the refetch.
    onMutate: (id?: string) => {
      qc.setQueryData<AppNotification[]>(keys.list, (list) =>
        list?.map((n) => (id === undefined || n.id === id ? { ...n, read: true } : n)),
      );
      qc.setQueryData<number>(keys.unread, (count = 0) => (id === undefined ? 0 : Math.max(0, count - 1)));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useMarkNotificationRead() {
  return useMarkRead((id) => apiClient.post(`/notifications/${id}/read`));
}

export function useMarkAllNotificationsRead() {
  return useMarkRead(() => apiClient.post("/notifications/read-all"));
}
