// Chat itself is not wired yet — it will call the ML service once that exists.
import { FAQ_ENTRIES, type FaqEntry } from "@/entities/faq";
import { apiClient, USE_MOCK_API } from "@/shared/api/client";
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
