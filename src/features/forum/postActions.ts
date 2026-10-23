import type { Answer, Thread } from "@/entities/forum";
import { apiClient, getErrorStatus } from "@/shared/api/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { forumKeys } from "./api";

// Editing and deleting own posts (admins may delete any). Edits go through
// the AI moderation again on the backend.

/**
 * Why an edit or delete failed, for the message shown: "underReview" = the
 * post is held by moderation and can't be edited (409); "blocked" = the new
 * text breaks the rules and wasn't saved (422); "forbidden" = not yours (403).
 */
export type PostActionError = "underReview" | "blocked" | "forbidden" | "failed";

export function postActionError(err: unknown): PostActionError {
  switch (getErrorStatus(err)) {
    case 409:
      return "underReview";
    case 422:
      return "blocked";
    case 403:
      return "forbidden";
    default:
      return "failed";
  }
}

interface ThreadDetail {
  thread: Thread;
  answers: Answer[];
}

/** Puts the saved post into the cached thread page, then refetches it (the AI check status changes). */
function useThreadCache(threadId: string) {
  const qc = useQueryClient();
  return {
    update: (fn: (d: ThreadDetail) => ThreadDetail) =>
      qc.setQueryData<ThreadDetail>(forumKeys.thread(threadId), (d) => (d ? fn(d) : d)),
    refresh: () => void qc.invalidateQueries({ queryKey: forumKeys.all }),
    remove: () => qc.removeQueries({ queryKey: forumKeys.thread(threadId) }),
  };
}

export function useUpdateThread(threadId: string) {
  const cache = useThreadCache(threadId);
  return useMutation({
    mutationFn: async (input: { title: string; body: string; tags: string[] }) => {
      const { data } = await apiClient.patch<{ title: string; body: string; tags?: string[]; moderation_status?: Thread["moderationStatus"] }>(
        `/threads/${threadId}`,
        input,
      );
      return data;
    },
    onSuccess: (data) => {
      cache.update((d) => ({
        ...d,
        thread: { ...d.thread, title: data.title, body: data.body, tags: data.tags ?? [], moderationStatus: data.moderation_status },
      }));
      cache.refresh();
    },
  });
}

export function useDeleteThread(threadId: string) {
  const cache = useThreadCache(threadId);
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/threads/${threadId}`);
    },
    onSuccess: () => {
      cache.remove();
      cache.refresh();
    },
  });
}

export function useUpdateAnswer(threadId: string) {
  const cache = useThreadCache(threadId);
  return useMutation({
    mutationFn: async ({ answerId, body }: { answerId: string; body: string }) => {
      const { data } = await apiClient.patch<{ body: string; moderation_status?: Answer["moderationStatus"] }>(
        `/comments/${answerId}`,
        { body },
      );
      return { answerId, data };
    },
    onSuccess: ({ answerId, data }) => {
      cache.update((d) => ({
        ...d,
        answers: d.answers.map((a) =>
          a.id === answerId ? { ...a, body: data.body, moderationStatus: data.moderation_status } : a,
        ),
      }));
      cache.refresh();
    },
  });
}

export function useDeleteAnswer(threadId: string) {
  const cache = useThreadCache(threadId);
  return useMutation({
    mutationFn: async (answerId: string) => {
      await apiClient.delete(`/comments/${answerId}`);
      return answerId;
    },
    onSuccess: (answerId) => {
      cache.update((d) => ({
        thread: { ...d.thread, answerCount: Math.max(0, d.thread.answerCount - 1) },
        answers: d.answers.filter((a) => a.id !== answerId),
      }));
      cache.refresh();
    },
  });
}
