import type { Answer, Thread, ThreadSort } from "@/entities/forum";
import { useAuth } from "@/app/AuthContext";
import { parseModerationNotice, type ModerationNotice } from "@/features/moderation/notice";
import { apiClient, USE_MOCK_API } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as repo from "./forumRepository";

export const forumKeys = {
  all: ["forum"] as const,
  threads: (sort: ThreadSort) => [...forumKeys.all, "threads", sort] as const,
  thread: (id: string) => [...forumKeys.all, "thread", id] as const,
};

// --- Backend shapes (internal/models in the Go backend) and adapters ---

interface ApiThread {
  id: number;
  user_id: number;
  author_name: string;
  title: string;
  body: string;
  score: number;
  comment_count: number;
  created_at: string;
}

interface ApiComment {
  id: number;
  thread_id: number;
  user_id: number;
  author_name: string;
  parent_comment_id?: number;
  body: string;
  score: number;
  created_at: string;
}

function toThread(t: ApiThread): Thread {
  return {
    id: String(t.id),
    authorId: String(t.user_id),
    authorName: t.author_name,
    title: t.title,
    body: t.body,
    createdAt: t.created_at,
    answerCount: t.comment_count,
    score: t.score,
  };
}

function toAnswer(c: ApiComment, userId: string | undefined): Answer {
  const id = String(c.id);
  return {
    id,
    threadId: String(c.thread_id),
    authorId: String(c.user_id),
    authorName: c.author_name,
    body: c.body,
    createdAt: c.created_at,
    likes: c.score,
    likedByUserIds: userId && readLikes(userId).has(id) ? [userId] : [],
  };
}

// The backend toggles a vote when the same value is sent twice, but never says
// whether the current user has voted. Remember our own likes per user locally.
const LIKES_KEY = "ai_helpdesk_liked_answers";

function readLikes(userId: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(LIKES_KEY) ?? "{}") as Record<string, string[]>;
    return new Set(all[userId] ?? []);
  } catch {
    return new Set();
  }
}

function writeLikes(userId: string, likes: Set<string>) {
  let all: Record<string, string[]> = {};
  try {
    all = JSON.parse(localStorage.getItem(LIKES_KEY) ?? "{}") as Record<string, string[]>;
  } catch {
    // start fresh
  }
  all[userId] = [...likes];
  localStorage.setItem(LIKES_KEY, JSON.stringify(all));
}

const sortAnswers = (answers: Answer[]) =>
  answers.sort((a, b) => b.likes - a.likes || b.createdAt.localeCompare(a.createdAt));

// --- Fetchers ---

async function fetchThreads(sort: ThreadSort): Promise<Thread[]> {
  if (USE_MOCK_API) return repo.listThreads(sort);
  const { data } = await apiClient.get<{ threads: ApiThread[] }>("/feed", {
    params: { sort: sort === "newest" ? "new" : "top", page_size: 50 },
  });
  return data.threads.map(toThread);
}

interface ThreadDetail {
  thread: Thread;
  answers: Answer[];
}

async function fetchThreadDetail(id: string, userId: string | undefined): Promise<ThreadDetail> {
  if (USE_MOCK_API) {
    const thread = repo.getThread(id);
    if (!thread) throw new Error("Thread not found");
    return { thread, answers: repo.listAnswers(id) };
  }
  const { data } = await apiClient.get<{ thread: ApiThread; comments: ApiComment[] }>(
    `/threads/${id}`,
  );
  return {
    thread: toThread(data.thread),
    answers: sortAnswers(data.comments.map((c) => toAnswer(c, userId))),
  };
}

// --- Hooks ---

export function useThreads(sort: ThreadSort) {
  return useQuery({
    queryKey: forumKeys.threads(sort),
    queryFn: () => fetchThreads(sort),
  });
}

// Thread and its answers come from one request; both hooks share the cache entry.
function useThreadDetail<T>(threadId: string, select: (d: ThreadDetail) => T) {
  const { user } = useAuth();
  return useQuery({
    queryKey: forumKeys.thread(threadId),
    queryFn: () => fetchThreadDetail(threadId, user?.id),
    enabled: Boolean(threadId),
    select,
  });
}

export function useThread(threadId: string) {
  return useThreadDetail(threadId, (d) => d.thread);
}

export function useAnswers(threadId: string) {
  return useThreadDetail(threadId, (d) => d.answers);
}

// A new question/answer is either published right away, or held back by the AI moderation
// and sent to the moderators ("pending"). The backend answers 201 or 202 respectively.
export type CreateThreadResult =
  | { kind: "published"; thread: Thread }
  | { kind: "pending"; notice: ModerationNotice };

export type CreateAnswerResult =
  | { kind: "published"; answer: Answer }
  | { kind: "pending"; notice: ModerationNotice };

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      authorId: string;
      authorName: string;
      title: string;
      body: string;
    }): Promise<CreateThreadResult> => {
      if (USE_MOCK_API) return { kind: "published", thread: repo.createThread(input) };
      // The backend takes the author from the login token, not the request body.
      const { data } = await apiClient.post<ApiThread>("/threads", {
        title: input.title,
        body: input.body,
      });
      const notice = parseModerationNotice(data);
      if (notice) return { kind: "pending", notice };
      return { kind: "published", thread: toThread(data) };
    },
    onSuccess: (result) => {
      if (result.kind === "published") void qc.invalidateQueries({ queryKey: forumKeys.all });
    },
  });
}

export function useCreateAnswer(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      authorId: string;
      authorName: string;
      body: string;
    }): Promise<CreateAnswerResult> => {
      if (USE_MOCK_API) return { kind: "published", answer: repo.createAnswer({ ...input, threadId }) };
      const { data } = await apiClient.post<ApiComment>(`/threads/${threadId}/comments`, {
        body: input.body,
      });
      const notice = parseModerationNotice(data);
      if (notice) return { kind: "pending", notice };
      return { kind: "published", answer: toAnswer(data, input.authorId) };
    },
    onSuccess: (result) => {
      if (result.kind === "published") void qc.invalidateQueries({ queryKey: forumKeys.all });
    },
  });
}

export function useLikeAnswer(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ answerId, userId }: { answerId: string; userId: string }) => {
      if (USE_MOCK_API) return repo.toggleLikeAnswer(answerId, userId);
      await apiClient.post<{ score: number }>(`/comments/${answerId}/vote`, { value: 1 });
      const likes = readLikes(userId);
      if (likes.has(answerId)) likes.delete(answerId);
      else likes.add(answerId);
      writeLikes(userId, likes);
    },
    onMutate: async ({ answerId, userId }) => {
      const key = forumKeys.thread(threadId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ThreadDetail>(key);
      if (previous) {
        qc.setQueryData<ThreadDetail>(key, {
          ...previous,
          answers: previous.answers.map((a) => {
            if (a.id !== answerId) return a;
            const liked = a.likedByUserIds.includes(userId);
            return {
              ...a,
              likes: liked ? a.likes - 1 : a.likes + 1,
              likedByUserIds: liked
                ? a.likedByUserIds.filter((id) => id !== userId)
                : [...a.likedByUserIds, userId],
            };
          }),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(forumKeys.thread(threadId), ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: forumKeys.all });
    },
  });
}
