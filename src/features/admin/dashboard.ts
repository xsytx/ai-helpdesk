// Admin dashboard (sprint 7, story 19): GET /api/admin/dashboard?days=7|30|90.
// Counts for the period, the AI chat per day, the most asked and unanswered
// questions, courses asked about and forum questions waiting for an answer.
import type { ChatInsight } from "@/features/chat/insights";
import { apiClient } from "@/shared/api/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

export type DashboardPeriod = 7 | 30 | 90;

export interface DashboardTotals {
  chat_questions: number;
  ai_answers: number;
  ai_answers_today: number;
  faq_answers: number;
  unanswered: number;
  liked: number;
  disliked: number;
  active_students: number;
  new_students: number;
  total_students: number;
  forum_questions: number;
  forum_answers: number;
  forum_open_total: number;
  reviews: number;
}

/** One day of the chat (Almaty date, "2026-11-26"). */
export interface DashboardDay {
  day: string;
  answered: number;
  faq: number;
  unanswered: number;
}

export interface Dashboard {
  days: number;
  totals: DashboardTotals;
  /** The same counts for the days just before the period (as many), to compare. */
  previous: DashboardTotals;
  daily: DashboardDay[];
  /** Today's calls to the AI by kind, and the free quota to compare with (0 = not set). */
  ai_calls_today: { chat: number; moderation: number; summary: number };
  ai_quota: number;
  /** The latest answers students marked 👎. */
  disliked: ChatInsight[];
  top_questions: { question: string; students: number; asks: number; last_at: string }[];
  unanswered: ChatInsight[];
  top_courses: { code: string; name: string; questions: number }[];
  open_threads: { id: number; title: string; created_at: string }[];
}

export function useAdminDashboard(days: DashboardPeriod) {
  return useQuery({
    queryKey: ["admin", "dashboard", days],
    queryFn: async () => (await apiClient.get<Dashboard>("/admin/dashboard", { params: { days } })).data,
    placeholderData: keepPreviousData,
    // Fresh enough for an overview; paused in background tabs like the rest of the admin panel.
    refetchInterval: 60_000,
  });
}
