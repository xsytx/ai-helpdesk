import { apiClient, getErrorStatus, HttpStatusError, postStream } from "@/shared/api/client";
import type { Locale, TranslationKey } from "@/i18n/translations";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface ChatHistoryMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  text: string;
  forum_answer?: string | null;
  ai_explanation?: string | null;
  basis?: string | null;
  language?: string | null;
  /** Where forum_answer came from: "faq" or "forum" (then source_thread_id is the question). */
  source_type?: string | null;
  source_thread_id?: number | null;
  rating?: ChatRating | null;
}

/** A student's 👍 (1) / 👎 (-1) on an answer. */
export type ChatRating = 1 | -1;

export interface ChatAskResponse {
  request_id: string;
  status: "answered" | "fallback";
  answer: string;
  forum_answer?: string | null;
  ai_explanation?: string;
  language: string;
  basis: string;
  source_type?: string;
  /** For a forum answer: the question it answers (thread_id) and whether it is the accepted one. */
  source?: { question: string; category: string; thread_id?: number; accepted?: boolean } | null;
  conversation: ApiConversation;
  /** The saved answer, for 👍/👎 (missing if saving it failed). */
  message_id?: number;
}

interface ApiConversation {
  id: number;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

/** One of the student's separate chats with the assistant. */
export interface ChatConversation {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
  /** Time of the last message. */
  updatedAt: string;
}

export function toConversation(c: ApiConversation): ChatConversation {
  return { id: String(c.id), title: c.title, pinned: c.pinned, createdAt: c.created_at, updatedAt: c.updated_at };
}

const CHAT_TIMEOUT_MS = 190_000;

export const chatKeys = {
  conversations: ["chat", "conversations"] as const,
  messages: (id: string) => ["chat", "messages", id] as const,
};

export interface ConversationList {
  conversations: ChatConversation[];
  /** Unpinned chats without a message for this many days are deleted (0 = never). */
  retentionDays: number;
}

/** Pinned first, then the most recently active (same order as the server). */
export function sortConversations(list: ChatConversation[]): ChatConversation[] {
  return [...list].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || Number(b.id) - Number(a.id),
  );
}

export function useChatConversations() {
  return useQuery({
    queryKey: chatKeys.conversations,
    queryFn: async (): Promise<ConversationList> => {
      const { data } = await apiClient.get<{ conversations: ApiConversation[]; retention_days: number }>(
        "/chat/conversations",
      );
      return { conversations: data.conversations.map(toConversation), retentionDays: data.retention_days };
    },
  });
}

export interface ConversationMessages {
  conversation: ChatConversation;
  messages: UiChatMessage[];
}

export function useChatMessages(id: string | undefined) {
  return useQuery({
    queryKey: chatKeys.messages(id ?? ""),
    enabled: Boolean(id),
    // A deleted chat (or someone else's) is a 404: no point asking again.
    retry: (count, err) => getErrorStatus(err) !== 404 && count < 1,
    queryFn: async (): Promise<ConversationMessages> => {
      const { data } = await apiClient.get<{ conversation: ApiConversation; messages: ChatHistoryMessage[] }>(
        `/chat/conversations/${id}/messages`,
      );
      return { conversation: toConversation(data.conversation), messages: historyToUiMessages(data.messages) };
    },
  });
}

/** Puts a changed or new conversation into the cached list. */
export function upsertConversation(old: ConversationList | undefined, conv: ChatConversation): ConversationList | undefined {
  if (!old) return old;
  return { ...old, conversations: sortConversations([conv, ...old.conversations.filter((c) => c.id !== conv.id)]) };
}

export function useUpdateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; title?: string; pinned?: boolean }) => {
      const { data } = await apiClient.patch<ApiConversation>(`/chat/conversations/${id}`, patch);
      return toConversation(data);
    },
    // Shown at once; put back if the server says no.
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: chatKeys.conversations });
      const previous = qc.getQueryData<ConversationList>(chatKeys.conversations);
      const current = previous?.conversations.find((c) => c.id === id);
      if (current) qc.setQueryData(chatKeys.conversations, upsertConversation(previous, { ...current, ...patch }));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(chatKeys.conversations, ctx.previous);
    },
    onSuccess: (conv) => {
      qc.setQueryData<ConversationList>(chatKeys.conversations, (old) => upsertConversation(old, conv));
      qc.setQueryData<ConversationMessages>(chatKeys.messages(conv.id), (old) => (old ? { ...old, conversation: conv } : old));
    },
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/chat/conversations/${id}`);
      return id;
    },
    onSuccess: (id) => {
      qc.setQueryData<ConversationList>(chatKeys.conversations, (old) =>
        old ? { ...old, conversations: old.conversations.filter((c) => c.id !== id) } : old,
      );
      qc.removeQueries({ queryKey: chatKeys.messages(id) });
    },
  });
}

/** Asks the assistant; without conversationId the question starts a new chat. */
export async function askChat(question: string, conversationId?: string, signal?: AbortSignal): Promise<ChatAskResponse> {
  const { data } = await apiClient.post<ChatAskResponse>(
    "/chat/ask",
    { question, ...(conversationId ? { conversation_id: Number(conversationId) } : {}) },
    { timeout: CHAT_TIMEOUT_MS, signal },
  );
  return data;
}

type StreamEvent =
  | { type: "conversation"; conversation: ApiConversation }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | ({ type: "done" } & ChatAskResponse)
  | { type: "error"; status?: number; error?: string };

export interface AskStreamHandlers {
  /** The chat the answer goes to (sent once, with the first text; a new chat exists from then on). */
  onConversation: (conversation: ChatConversation) => void;
  /** The next piece of the answer. */
  onDelta: (text: string) => void;
  /** Throw away the text shown so far: the model starts again. */
  onReset: () => void;
}

/**
 * Asks the assistant and receives the answer while the model writes it
 * (POST /chat/ask/stream, one JSON object per line). Resolves with the same
 * response as askChat; aborting the signal stops the answer (the server
 * keeps what was written so far).
 */
export async function askChatStream(
  question: string,
  conversationId: string | undefined,
  handlers: AskStreamHandlers,
  signal?: AbortSignal,
): Promise<ChatAskResponse> {
  const res = await postStream(
    "/chat/ask/stream",
    { question, ...(conversationId ? { conversation_id: Number(conversationId) } : {}) },
    signal,
  );
  if (!res.body) throw new HttpStatusError(502);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffered += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "conversation") handlers.onConversation(toConversation(event.conversation));
      else if (event.type === "delta") handlers.onDelta(event.text);
      else if (event.type === "reset") handlers.onReset();
      else if (event.type === "done") return event;
      else if (event.type === "error") throw new HttpStatusError(event.status ?? 502);
    }
    if (done) throw new HttpStatusError(502, "the answer stream ended early");
  }
}

/**
 * An FAQ button in the chat: the server saves the question and the FAQ answer
 * (in the site language) at once, without the model.
 */
export async function askFaq(
  faqId: string,
  locale: Locale,
  conversationId?: string,
  signal?: AbortSignal,
): Promise<ChatAskResponse> {
  const { data } = await apiClient.post<ChatAskResponse>(
    "/chat/faq",
    { faq_id: Number(faqId), lang: locale, ...(conversationId ? { conversation_id: Number(conversationId) } : {}) },
    { signal },
  );
  return data;
}

export async function fetchChatStatus(): Promise<"ok" | "degraded"> {
  const { data } = await apiClient.get<{ status: string }>("/chat/status");
  return data.status === "ok" ? "ok" : "degraded";
}

export function chatErrorMessage(err: unknown, t: (key: TranslationKey) => string): string {
  const status = getErrorStatus(err);
  if (status === 429) return t("chatTooManyRequests");
  if (status === 503) return t("chatAssistantUnavailable");
  if (status === 502 || status === 504) return t("chatAssistantError");
  if (status === 400) return t("chatInvalidQuestion");
  if (status === undefined) return t("serverUnavailable");
  return t("chatAssistantError");
}

export function historyToUiMessages(rows: ChatHistoryMessage[]): UiChatMessage[] {
  return rows.map((m) => ({
    id: String(m.id),
    role: m.role,
    text: m.text,
    forumAnswer: m.forum_answer ?? undefined,
    aiExplanation: m.ai_explanation ?? undefined,
    basis: m.basis ?? undefined,
    sourceType: m.source_type ?? undefined,
    sourceThreadId: m.source_thread_id ? String(m.source_thread_id) : undefined,
    status: m.role === "assistant" && m.basis === "none" ? "fallback" : "answered",
    serverId: m.role === "assistant" ? String(m.id) : undefined,
    rating: m.rating ?? undefined,
  }));
}

export interface UiChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  forumAnswer?: string;
  aiExplanation?: string;
  basis?: string;
  /** "forum": forumAnswer is a community answer from the question sourceThreadId. */
  sourceType?: string;
  sourceThreadId?: string;
  status?: "answered" | "fallback";
  error?: boolean;
  retryQuestion?: string;
  /** Saved answers only: the message id on the server (for 👍/👎). */
  serverId?: string;
  rating?: ChatRating;
}

export function askResponseToUiMessage(res: ChatAskResponse): UiChatMessage {
  return {
    // The saved message id, like in the history (request ids repeat: every
    // answer from one FAQ entry is "faq-<id>").
    id: res.message_id ? String(res.message_id) : `${res.request_id}-${crypto.randomUUID()}`,
    role: "assistant",
    text: res.answer,
    forumAnswer: res.forum_answer ?? undefined,
    aiExplanation: res.ai_explanation,
    basis: res.basis,
    sourceType: res.source_type,
    sourceThreadId: res.source_type === "forum" && res.source?.thread_id ? String(res.source.thread_id) : undefined,
    status: res.status,
    serverId: res.message_id ? String(res.message_id) : undefined,
  };
}

/**
 * 👍/👎 on an answer (value 0 takes it back). Shown at once in the chat,
 * put back if saving fails.
 */
export function useRateAnswer(conversationId: string | undefined) {
  const qc = useQueryClient();
  const key = chatKeys.messages(conversationId ?? "");
  const setRating = (serverId: string, rating: ChatRating | undefined) =>
    qc.setQueryData<ConversationMessages>(key, (d) =>
      d ? { ...d, messages: d.messages.map((m) => (m.serverId === serverId ? { ...m, rating } : m)) } : d,
    );
  return useMutation({
    mutationFn: async ({ serverId, value }: { serverId: string; value: ChatRating | 0; previous?: ChatRating }) => {
      await apiClient.put(`/chat/messages/${serverId}/rating`, { value });
    },
    onMutate: ({ serverId, value }) => setRating(serverId, value === 0 ? undefined : value),
    onError: (_err, { serverId, previous }) => setRating(serverId, previous),
  });
}
