import { useAuth } from "@/app/AuthContext";
import { apiClient, getAuthToken, USE_MOCK_API } from "@/shared/api/client";
import { forumKeys } from "@/features/forum/api";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Someone answered in a thread you follow (yours, or one you answered in), or replied to your answer. */
export interface AppNotification {
  id: string;
  type: "comment_on_thread" | "reply_to_comment" | "mention" | "answer_liked" | "answer_accepted";
  threadId: string;
  threadTitle: string;
  /** The answer or reply it is about (none = the question itself). */
  commentId?: string;
  actorName: string;
  read: boolean;
  createdAt: string;
}

interface ApiNotification {
  id: number;
  type: AppNotification["type"];
  thread_id: number;
  thread_title: string;
  comment_id?: number;
  actor_name: string;
  read: boolean;
  created_at: string;
}

const keys = {
  all: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  list: ["notifications", "list"] as const,
};

/**
 * The badge polls this light endpoint (paused in background tabs); while the
 * live connection is open it only checks now and then, as a safety net.
 */
const UNREAD_REFRESH_MS = 30_000;
const UNREAD_REFRESH_LIVE_MS = 120_000;

export function useUnreadNotificationCount(live = false) {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.unread,
    enabled: Boolean(user) && !USE_MOCK_API,
    queryFn: async () => {
      const { data } = await apiClient.get<{ unread: number }>("/notifications/unread-count");
      return data.unread;
    },
    refetchInterval: live ? UNREAD_REFRESH_LIVE_MS : UNREAD_REFRESH_MS,
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
        commentId: n.comment_id ? String(n.comment_id) : undefined,
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

/**
 * Live notifications: while this tab is visible, a connection to the backend
 * (GET /api/notifications/stream, Server-Sent Events) says the moment one of
 * the user's notifications changes; the bell and that question reload at
 * once. Hidden tabs close it (browsers allow few connections per site) and
 * reconnect when shown; a broken connection retries, slower each time.
 * Returns whether it is connected.
 */
export function useLiveNotifications(): boolean {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!userId || USE_MOCK_API) return;
    let stopped = false;
    let ac: AbortController | null = null;
    let retry: number | undefined;
    let delay = 2_000;
    let refresh: number | undefined;
    const threads = new Set<string>();

    // Events come in bursts (e.g. "mark all read"): reload once, a moment later.
    const onEvent = (threadId?: string) => {
      if (threadId) threads.add(threadId);
      window.clearTimeout(refresh);
      refresh = window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: keys.all });
        for (const id of threads) void qc.invalidateQueries({ queryKey: forumKeys.thread(id) });
        threads.clear();
      }, 300);
    };

    const connect = async () => {
      if (stopped || ac || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      ac = controller;
      try {
        const token = getAuthToken();
        const res = await fetch(`${apiClient.defaults.baseURL}/notifications/stream`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        setLive(true);
        delay = 2_000;
        onEvent(); // anything missed while away
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let end;
          while ((end = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, end);
            buf = buf.slice(end + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data:")) continue;
              try {
                const ev = JSON.parse(line.slice(5)) as { thread_id?: number };
                onEvent(ev.thread_id ? String(ev.thread_id) : undefined);
              } catch {
                onEvent();
              }
            }
          }
        }
      } catch {
        // Closed, aborted or failed: below decides whether to try again.
      } finally {
        if (ac === controller) ac = null;
        setLive(false);
      }
      if (!stopped && document.visibilityState === "visible") {
        retry = window.setTimeout(() => void connect(), delay);
        delay = Math.min(delay * 2, 30_000);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void connect();
      else ac?.abort();
    };

    void connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      ac?.abort();
      window.clearTimeout(retry);
      window.clearTimeout(refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, qc]);

  return live;
}
