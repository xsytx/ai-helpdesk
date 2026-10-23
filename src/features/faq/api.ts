import { apiClient, USE_MOCK_API } from "@/shared/api/client";
import { FAQ_CATEGORIES, FAQ_ENTRIES, type FaqCategory, type FaqEntry, type LocalizedText } from "@/entities/faq";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface ApiFaq {
  id: number;
  question: string;
  question_kz: string;
  question_ru: string;
  answer: string;
  answer_kz: string;
  answer_ru: string;
  category: string;
  pinned: boolean;
}

function toFaqEntry(f: ApiFaq): FaqEntry {
  return {
    id: String(f.id),
    question: { en: f.question, kz: f.question_kz, ru: f.question_ru },
    answer: { en: f.answer, kz: f.answer_kz, ru: f.answer_ru },
    category: (FAQ_CATEGORIES as readonly string[]).includes(f.category) ? (f.category as FaqCategory) : "general",
    pinned: f.pinned,
  };
}

const faqKey = ["faq"] as const;

/** All FAQ entries in the admins' order. */
export function useFaqs() {
  return useQuery({
    queryKey: faqKey,
    queryFn: async (): Promise<FaqEntry[]> => {
      if (USE_MOCK_API) return FAQ_ENTRIES;
      const { data } = await apiClient.get<ApiFaq[]>("/faq");
      return data.map(toFaqEntry);
    },
    staleTime: 5 * 60_000,
  });
}

/** An entry as the admin edits it (no id yet for a new one). */
export interface FaqDraft {
  question: LocalizedText;
  answer: LocalizedText;
  category: FaqCategory;
  pinned: boolean;
}

function toApiBody(d: FaqDraft) {
  return {
    question: d.question.en,
    question_kz: d.question.kz,
    question_ru: d.question.ru,
    answer: d.answer.en,
    answer_kz: d.answer.kz,
    answer_ru: d.answer.ru,
    category: d.category,
    pinned: d.pinned,
  };
}

/** Creates (no id) or updates an entry. */
export function useSaveFaq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id?: string; draft: FaqDraft }) => {
      const { data } = id
        ? await apiClient.patch<ApiFaq>(`/faq/${id}`, toApiBody(draft))
        : await apiClient.post<ApiFaq>("/faq", toApiBody(draft));
      return toFaqEntry(data);
    },
    onSuccess: (saved) => {
      qc.setQueryData<FaqEntry[]>(faqKey, (old) => {
        if (!old) return old;
        return old.some((f) => f.id === saved.id) ? old.map((f) => (f.id === saved.id ? saved : f)) : [...old, saved];
      });
    },
  });
}

export function useDeleteFaq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/faq/${id}`);
      return id;
    },
    onSuccess: (id) => qc.setQueryData<FaqEntry[]>(faqKey, (old) => old?.filter((f) => f.id !== id)),
  });
}

/** Saves a new order (all ids, top to bottom); shown at once, undone on failure. */
export function useReorderFaqs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data } = await apiClient.post<ApiFaq[]>("/faq/reorder", { ids: ids.map(Number) });
      return data.map(toFaqEntry);
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: faqKey });
      const previous = qc.getQueryData<FaqEntry[]>(faqKey);
      if (previous) {
        const byId = new Map(previous.map((f) => [f.id, f]));
        qc.setQueryData(faqKey, ids.map((id) => byId.get(id)).filter((f): f is FaqEntry => Boolean(f)));
      }
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(faqKey, ctx.previous);
    },
    onSuccess: (list) => qc.setQueryData(faqKey, list),
  });
}
