import type { Answer, ModerationStatus, Thread, ThreadSort } from "@/entities/forum";
import type { ReputationLevel } from "@/entities/reputation";
import { useAuth } from "@/app/AuthContext";
import { parseModerationNotice, type ModerationNotice } from "@/features/moderation/notice";
import { apiClient, USE_MOCK_API } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as repo from "./forumRepository";
import { safeStorage } from "@/shared/lib/storage";
import { shrinkImage } from "@/shared/lib/image";

export const forumKeys = {
  all: ["forum"] as const,
  threads: (sort: ThreadSort, filter: ThreadFilter = {}) =>
    [...forumKeys.all, "threads", sort, filter.q ?? "", (filter.tags ?? []).join(",")] as const,
  trendingTags: () => [...forumKeys.all, "trending-tags"] as const,
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
  tags?: string[];
  created_at: string;
  moderation_status?: ModerationStatus;
  search_match?: Thread["searchMatch"];
  accepted_comment_id?: number;
  attachments?: { id: number; url: string }[];
  author_avatar?: string;
  photo_count?: number;
  preview_photos?: string[];
  edited_at?: string;
  accepted_at?: string;
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
  moderation_status?: ModerationStatus;
  author_avatar?: string;
  attachments?: { id: number; url: string }[];
  edited_at?: string;
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
    tags: t.tags ?? [],
    moderationStatus: t.moderation_status,
    searchMatch: t.search_match,
    acceptedAnswerId: t.accepted_comment_id ? String(t.accepted_comment_id) : undefined,
    attachments: t.attachments?.map((a) => ({ id: String(a.id), url: a.url })),
    authorAvatar: t.author_avatar ?? "",
    photoCount: t.photo_count ?? 0,
    previewPhotos: t.preview_photos ?? [],
    editedAt: t.edited_at,
    acceptedAt: t.accepted_at,
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
    moderationStatus: c.moderation_status,
    authorAvatar: c.author_avatar ?? "",
    attachments: c.attachments?.map((a) => ({ id: String(a.id), url: a.url })),
    parentId: c.parent_comment_id ? String(c.parent_comment_id) : undefined,
    editedAt: c.edited_at,
    // A remembered like on an answer with no likes is stale (e.g. un-liked on
    // another device), so it doesn't count.
    likedByUserIds: userId && c.score > 0 && readLikes(userId).has(id) ? [userId] : [],
  };
}

// The backend toggles a vote when the same value is sent twice, but never says
// whether the current user has voted. Remember our own likes per user locally.
const LIKES_KEY = "ai_helpdesk_liked_answers";

function readLikes(userId: string): Set<string> {
  try {
    const all = JSON.parse(safeStorage.get(LIKES_KEY) ?? "{}") as Record<string, string[]>;
    return new Set(all[userId] ?? []);
  } catch {
    return new Set();
  }
}

function writeLikes(userId: string, likes: Set<string>) {
  let all: Record<string, string[]> = {};
  try {
    all = JSON.parse(safeStorage.get(LIKES_KEY) ?? "{}") as Record<string, string[]>;
  } catch {
    // start fresh
  }
  all[userId] = [...likes];
  safeStorage.set(LIKES_KEY, JSON.stringify(all));
}

const sortAnswers = (answers: Answer[]) =>
  answers.sort((a, b) => b.likes - a.likes || b.createdAt.localeCompare(a.createdAt));

// --- Fetchers ---

/** What the forum list shows: everything, a search (q), or questions with any of these tags. */
export interface ThreadFilter {
  q?: string;
  tags?: string[];
}

async function fetchThreads(sort: ThreadSort, filter: ThreadFilter): Promise<Thread[]> {
  if (USE_MOCK_API) {
    const q = filter.q?.toLowerCase();
    return repo
      .listThreads(sort)
      .filter((t) => !q || `${t.title} ${t.body}`.toLowerCase().includes(q))
      .filter((t) => !filter.tags?.length || filter.tags.some((x) => t.tags?.includes(x)));
  }
  // A search is ordered by relevance (the backend decides), so the sort
  // toggle applies to the feed only, with or without tags.
  if (filter.q) {
    const { data } = await apiClient.get<{ threads: ApiThread[] }>("/search", {
      params: { q: filter.q, page_size: 50 },
    });
    return data.threads.map(toThread);
  }
  const { data } = await apiClient.get<{ threads: ApiThread[] }>("/feed", {
    params: {
      sort: sort === "newest" ? "new" : sort === "unanswered" ? "unanswered" : "top",
      tags: filter.tags?.length ? filter.tags.join(",") : undefined,
      page_size: 50,
    },
  });
  return data.threads.map(toThread);
}

export interface ThreadDetail {
  thread: Thread;
  answers: Answer[];
  /** The viewer follows the thread (gets notifications about new answers). */
  subscribed?: boolean;
}

async function fetchThreadDetail(id: string, userId: string | undefined): Promise<ThreadDetail> {
  if (USE_MOCK_API) {
    const thread = repo.getThread(id);
    if (!thread) throw new Error("Thread not found");
    return { thread, answers: repo.listAnswers(id) };
  }
  const { data } = await apiClient.get<{
    thread: ApiThread;
    comments: ApiComment[];
    subscribed?: boolean;
    reputation?: Record<string, { points: number; level: ReputationLevel }>;
  }>(`/threads/${id}`);
  // Everyone's level, for the badge next to their name.
  const level = (authorId: string) => {
    const r = data.reputation?.[authorId];
    return r ? { authorLevel: r.level, authorPoints: r.points } : {};
  };
  const thread = toThread(data.thread);
  return {
    thread: { ...thread, ...level(thread.authorId) },
    answers: sortAnswers(data.comments.map((c) => ({ ...toAnswer(c, userId), ...level(String(c.user_id)) }))),
    subscribed: data.subscribed ?? false,
  };
}

// --- Hooks ---

// --- Auto-refresh (only while the tab is visible; TanStack Query pauses
// intervals in background tabs) ---
const FEED_REFRESH_MS = 15_000;
const THREAD_REFRESH_MS = 10_000;
/** While the AI is still checking a post on the page, look again quickly. */
const CHECKING_REFRESH_MS = 1_500;

const likeMutationKey = (threadId: string) => [...forumKeys.all, "like", threadId] as const;

export function useThreads(sort: ThreadSort, filter: ThreadFilter = {}) {
  return useQuery({
    queryKey: forumKeys.threads(sort, filter),
    queryFn: () => fetchThreads(sort, filter),
    refetchInterval: FEED_REFRESH_MS,
    refetchOnWindowFocus: true,
    // While a new search loads, the previous results stay on screen.
    placeholderData: (previous) => previous,
  });
}

export interface TrendingTag {
  name: string;
  count: number;
}

/** The most used tags on visible questions. */
export function useTrendingTags() {
  return useQuery({
    queryKey: forumKeys.trendingTags(),
    enabled: !USE_MOCK_API,
    queryFn: async () => {
      const { data } = await apiClient.get<TrendingTag[]>("/tags/trending", { params: { limit: 12 } });
      return data;
    },
    staleTime: 60_000,
  });
}

// Thread and its answers come from one request; both hooks share the cache entry.
function useThreadDetail<T>(threadId: string, select: (d: ThreadDetail) => T) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useQuery({
    queryKey: forumKeys.thread(threadId),
    queryFn: () => fetchThreadDetail(threadId, user?.id),
    enabled: Boolean(threadId),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      // Don't refetch over a like that is still saving (it would flash the old count).
      if (qc.isMutating({ mutationKey: likeMutationKey(threadId) }) > 0) return false;
      const d = query.state.data;
      const checking =
        d?.thread.moderationStatus === "checking" ||
        d?.answers.some((a) => a.moderationStatus === "checking");
      return checking ? CHECKING_REFRESH_MS : THREAD_REFRESH_MS;
    },
    // Opened from a list: show the thread from the list right away while the
    // answers load (this also gives the title's page transition a target).
    placeholderData: () => {
      for (const [, threads] of qc.getQueriesData<Thread[]>({
        queryKey: [...forumKeys.all, "threads"],
      })) {
        const thread = threads?.find((t) => t.id === threadId);
        if (thread) return { thread, answers: [] };
      }
      return undefined;
    },
    select,
  });
}

export function useThread(threadId: string) {
  return useThreadDetail(threadId, (d) => d.thread);
}

export function useAnswers(threadId: string) {
  return useThreadDetail(threadId, (d) => d.answers);
}

/** Whether the viewer follows the thread; undefined while unknown. */
export function useThreadSubscribed(threadId: string) {
  return useThreadDetail(threadId, (d) => d.subscribed);
}

/**
 * Follow / unfollow a thread: followers get a notification for every new
 * answer. Asking or answering follows automatically.
 */
export function useFollowThread(threadId: string) {
  const qc = useQueryClient();
  const key = forumKeys.thread(threadId);
  const set = (subscribed: boolean) =>
    qc.setQueryData<ThreadDetail>(key, (d) => (d ? { ...d, subscribed } : d));
  return useMutation({
    mutationFn: async (follow: boolean) => {
      if (follow) await apiClient.post(`/threads/${threadId}/subscribe`);
      else await apiClient.delete(`/threads/${threadId}/subscribe`);
    },
    onMutate: (follow) => set(follow),
    onError: (_err, follow) => set(!follow),
  });
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
      tags?: string[];
    }): Promise<CreateThreadResult> => {
      if (USE_MOCK_API) return { kind: "published", thread: repo.createThread(input) };
      // The backend takes the author from the login token, not the request body.
      const { data } = await apiClient.post<ApiThread>("/threads", {
        title: input.title,
        body: input.body,
        tags: input.tags ?? [],
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
      /** A reply: the answer it goes under. */
      parentId?: string;
    }): Promise<CreateAnswerResult> => {
      if (USE_MOCK_API) return { kind: "published", answer: repo.createAnswer({ ...input, threadId }) };
      const { data } = await apiClient.post<ApiComment>(`/threads/${threadId}/comments`, {
        body: input.body,
        parent_comment_id: input.parentId ? Number(input.parentId) : undefined,
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
    mutationKey: likeMutationKey(threadId),
    mutationFn: async ({
      answerId,
      userId,
      scoreBefore,
    }: {
      answerId: string;
      userId: string;
      /** The answer's score from the server before this click. */
      scoreBefore: number;
    }) => {
      if (USE_MOCK_API) {
        repo.toggleLikeAnswer(answerId, userId);
        return undefined;
      }
      const { data } = await apiClient.post<{ score: number }>(`/comments/${answerId}/vote`, {
        value: 1,
      });
      // The backend toggles our vote without saying which way it went: our +1
      // raises the score when it adds a like and lowers it when it removes one.
      // Trusting that (instead of flipping our own guess) keeps the like state
      // in sync even if it was changed in another browser or on another device.
      const liked = data.score > scoreBefore;
      const likes = readLikes(userId);
      if (liked) likes.add(answerId);
      else likes.delete(answerId);
      writeLikes(userId, likes);
      return { score: data.score, liked };
    },
    onMutate: async ({ answerId, userId }) => {
      const key = forumKeys.thread(threadId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ThreadDetail>(key);
      if (previous) {
        qc.setQueryData<ThreadDetail>(key, {
          ...previous,
          // Re-sorted right away so the list reorders on click, not after the refetch.
          answers: sortAnswers(previous.answers.map((a) => {
            if (a.id !== answerId) return a;
            const liked = a.likedByUserIds.includes(userId);
            return {
              ...a,
              likes: liked ? Math.max(0, a.likes - 1) : a.likes + 1,
              likedByUserIds: liked
                ? a.likedByUserIds.filter((id) => id !== userId)
                : [...a.likedByUserIds, userId],
            };
          })),
        });
      }
      return { previous };
    },
    // Replace the optimistic guess with what the server actually did.
    onSuccess: (result, { answerId, userId }) => {
      if (!result) return;
      qc.setQueryData<ThreadDetail>(forumKeys.thread(threadId), (current) =>
        current && {
          ...current,
          answers: sortAnswers(
            current.answers.map((a) =>
              a.id !== answerId
                ? a
                : {
                    ...a,
                    likes: result.score,
                    likedByUserIds: result.liked ? [userId] : [],
                  },
            ),
          ),
        },
      );
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

/** "Maybe this was already asked": questions on the same topic as a title being written. */
export function useSimilarThreads(title: string) {
  const q = title.trim();
  return useQuery({
    queryKey: [...forumKeys.all, "similar", q],
    enabled: !USE_MOCK_API && q.length >= 8,
    queryFn: async () => {
      const { data } = await apiClient.get<{ threads: ApiThread[] }>("/threads/similar", { params: { q } });
      return data.threads.map(toThread);
    },
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

/** The question's author marks an answer as the solution (null takes it back). */
export function useAcceptAnswer(threadId: string) {
  const qc = useQueryClient();
  const key = forumKeys.thread(threadId);
  const set = (acceptedAnswerId: string | undefined) =>
    qc.setQueryData<ThreadDetail>(key, (d) => (d ? { ...d, thread: { ...d.thread, acceptedAnswerId } } : d));
  return useMutation({
    mutationFn: async ({ answerId }: { answerId: string | null; previous?: string }) => {
      await apiClient.post(`/threads/${threadId}/accept`, { comment_id: answerId ? Number(answerId) : null });
    },
    onMutate: ({ answerId }) => set(answerId ?? undefined),
    onError: (_err, { previous }) => set(previous),
    onSettled: () => void qc.invalidateQueries({ queryKey: [...forumKeys.all, "threads"] }),
  });
}

export type ReportReason = "spam" | "rude" | "wrong" | "other";

/** A student flags a question or an answer for the moderators. */
export function useReportPost() {
  return useMutation({
    mutationFn: async ({ kind, id, reason, details }: { kind: "thread" | "comment"; id: string; reason: ReportReason; details: string }) => {
      const text = details.trim() ? `${reason}: ${details.trim()}` : reason;
      await apiClient.post(`/${kind === "thread" ? "threads" : "comments"}/${id}/report`, { reason: text.slice(0, 500) });
    },
  });
}

/** Photos in one answer. */
export const MAX_ANSWER_PHOTOS = 4;

/**
 * Photos: at most 10 per question. Photos are shrunk before upload (see
 * shrinkImage), so a big phone photo is fine; what reaches the server must
 * be at most 5 MB (it checks again).
 */
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Largest file accepted before shrinking (GIFs aren't shrunk: MAX_PHOTO_BYTES). */
export const MAX_ORIGINAL_PHOTO_BYTES = 30 * 1024 * 1024;
export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export async function uploadPhoto(threadId: string, file: File) {
  const form = new FormData();
  form.append("file", await shrinkImage(file));
  const { data } = await apiClient.post<{ id: number; url: string }>(`/threads/${threadId}/attachments`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return { id: String(data.id), url: data.url };
}

export async function uploadAnswerPhoto(answerId: string, file: File) {
  const form = new FormData();
  form.append("file", await shrinkImage(file));
  const { data } = await apiClient.post<{ id: number; url: string }>(`/comments/${answerId}/attachments`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return { id: String(data.id), url: data.url };
}

export async function deletePhoto(photoId: string) {
  await apiClient.delete(`/attachments/${photoId}`);
}

/** The questions a user asked (their profile), newest first. */
export function useUserQuestions(userId: string) {
  return useQuery({
    queryKey: ["users", userId, "questions"],
    enabled: Boolean(userId) && !USE_MOCK_API,
    queryFn: async () => {
      const { data } = await apiClient.get<{ threads: ApiThread[] }>(`/users/${userId}/threads`, { params: { page_size: 50 } });
      return data.threads.map(toThread);
    },
  });
}
