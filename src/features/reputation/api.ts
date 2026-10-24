import { useAuth } from "@/app/AuthContext";
import { apiClient, USE_MOCK_API } from "@/shared/api/client";
import { useQuery } from "@tanstack/react-query";

import type { ReputationLevel } from "@/entities/reputation";

export type { ReputationLevel };

/** Points for helping: +10 per accepted solution, +2 per like from others, +1 per answer. */
export interface Reputation {
  points: number;
  answers: number;
  likes: number;
  solutions: number;
  level: ReputationLevel;
  /** Points the next level starts at; 0 at the top level. */
  nextLevelAt: number;
}

export interface ApiReputation {
  points: number;
  answers: number;
  likes: number;
  solutions: number;
  level: ReputationLevel;
  next_level_at: number;
}

export function toReputation(r: ApiReputation): Reputation {
  return {
    points: r.points,
    answers: r.answers,
    likes: r.likes,
    solutions: r.solutions,
    level: r.level,
    nextLevelAt: r.next_level_at,
  };
}

/** Points where each level starts (for the progress bar). */
export const LEVEL_FROM: Record<ReputationLevel, number> = { newcomer: 0, helper: 10, expert: 50, master: 150 };

export function useMyReputation() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reputation", "me", user?.id],
    enabled: Boolean(user) && !USE_MOCK_API,
    queryFn: async () => toReputation((await apiClient.get<ApiReputation>("/me/reputation")).data),
    staleTime: 60_000,
  });
}

export type HelpersPeriod = "week" | "month" | "all";

export interface Helper {
  userId: string;
  name: string;
  /** Points earned in the period. */
  points: number;
  solutions: number;
  level: ReputationLevel;
  avatar: string;
}

export function useTopHelpers(period: HelpersPeriod) {
  return useQuery({
    queryKey: ["reputation", "top", period],
    enabled: !USE_MOCK_API,
    queryFn: async () => {
      const { data } = await apiClient.get<{
        helpers: { user_id: number; name: string; points: number; solutions: number; level: ReputationLevel; avatar?: string }[];
      }>("/leaderboard", { params: { period, limit: 5 } });
      return data.helpers.map(
        (h): Helper => ({
          userId: String(h.user_id),
          name: h.name,
          points: h.points,
          solutions: h.solutions,
          level: h.level,
          avatar: h.avatar ?? "",
        }),
      );
    },
    staleTime: 60_000,
  });
}
