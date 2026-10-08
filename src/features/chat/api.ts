import { apiClient, getErrorStatus, USE_MOCK_API } from "@/shared/api/client";
import { FAQ_ENTRIES, type FaqEntry } from "@/entities/faq";
import type { TranslationKey } from "@/i18n/translations";
import { useQuery } from "@tanstack/react-query";

interface ApiFaq {
  id: number;
  question: string;
  answer: string;
}

async function fetchFaqs(): Promise<FaqEntry[]> {
  if (USE_MOCK_API) return FAQ_ENTRIES;
  const { data } = await apiClient.get<ApiFaq[]>("/faq");
  return data.map((f) => ({ id: String(f.id), question: f.question, answer: f.answer }));
}

export function useFaqs() {
  return useQuery({ queryKey: ["faq"], queryFn: fetchFaqs, staleTime: 5 * 60_000 });
}

export interface ChatHistoryMessage {
  id: number;
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
}

interface ChatHistoryResponse {
  messages: ChatHistoryMessage[];
  page: number;
  page_size: number;
  total: number;
}

const CHAT_TIMEOUT_MS = 190_000;

export async function fetchChatHistory(): Promise<ChatHistoryMessage[]> {
  const { data } = await apiClient.get<ChatHistoryResponse>("/chat/history", {
    params: { page: 1, page_size: 200 },
  });
  return data.messages;
}

export async function askChat(question: string, signal?: AbortSignal): Promise<ChatAskResponse> {
  const { data } = await apiClient.post<ChatAskResponse>(
    "/chat/ask",
    { question },
    { timeout: CHAT_TIMEOUT_MS, signal },
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
