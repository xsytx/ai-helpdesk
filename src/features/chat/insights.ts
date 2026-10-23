import type { FaqDraft } from "@/features/faq/api";
import type { Locale } from "@/i18n/translations";
import { apiClient } from "@/shared/api/client";
import { useQuery } from "@tanstack/react-query";

/** The admin panel's "AI chat" lists (no student names). */
export type InsightKind = "disliked" | "unanswered" | "frequent";

export interface ChatInsight {
  question: string;
  /** The student's question before it (helps read follow-ups like "and how much is it?"). */
  context?: string;
  /** The AI's answer ("disliked" / "unanswered"). */
  answer?: string;
  language?: string;
  /** How many different students asked it ("frequent"). */
  students: number;
  at: string;
}

export function useChatInsights(kind: InsightKind, days = 30) {
  return useQuery({
    queryKey: ["admin", "chat-insights", kind, days],
    queryFn: async () => {
      const { data } = await apiClient.get<{ items: ChatInsight[] }>("/admin/chat-insights", { params: { kind, days } });
      return data.items;
    },
  });
}

/** Site language of a text: the backend's language code, or a guess from the letters. */
export function insightLocale(item: ChatInsight): Locale {
  if (item.language === "kk" || item.language === "kz") return "kz";
  if (item.language === "ru") return "ru";
  if (item.language === "en") return "en";
  if (/[әғқңөұүһі]/i.test(item.question)) return "kz";
  if (/[а-яё]/i.test(item.question)) return "ru";
  return "en";
}

/**
 * A new FAQ entry started from a chat question: the question in its
 * language, and the AI's answer as a first draft only when it was a real
 * answer that a student rated 👎 (the admin corrects it).
 */
export function insightToFaqDraft(item: ChatInsight, kind: InsightKind): FaqDraft {
  const locale = insightLocale(item);
  const question = { en: "", kz: "", ru: "" };
  const answer = { en: "", kz: "", ru: "" };
  question[locale] = item.question.trim().slice(0, 200);
  if (kind === "disliked" && item.answer) answer[locale] = item.answer.trim().slice(0, 4000);
  return { question, answer, category: "general", pinned: false };
}
