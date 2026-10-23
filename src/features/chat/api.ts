import { apiClient, getErrorStatus } from "@/shared/api/client";
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
}

export interface ChatAskResponse {
  request_id: string;
  status: "answered" | "fallback";
  answer: string;
  forum_answer?: string | null;
  ai_explanation?: string;
  language: string;
  basis: string;
  source?: { question: string; category: string } | null;
  conversation: ApiConversation;
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
    status: m.role === "assistant" && m.basis === "none" ? "fallback" : "answered",
  }));
}

export interface UiChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  forumAnswer?: string;
  aiExplanation?: string;
  basis?: string;
  status?: "answered" | "fallback";
  error?: boolean;
  retryQuestion?: string;
}

export function askResponseToUiMessage(res: ChatAskResponse): UiChatMessage {
  return {
    id: res.request_id,
    role: "assistant",
    text: res.answer,
    forumAnswer: res.forum_answer ?? undefined,
    aiExplanation: res.ai_explanation,
    basis: res.basis,
    status: res.status,
  };
}
