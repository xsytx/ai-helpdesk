import type { Locale } from "@/i18n/translations";

/** Same list as the backend (faqs.category). */
export const FAQ_CATEGORIES = ["general", "account", "study", "campus", "forum"] as const;
export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export type LocalizedText = Record<Locale, string>;

export interface FaqEntry {
  id: string;
  question: LocalizedText;
  answer: LocalizedText;
  category: FaqCategory;
  /** Shown as an instant-answer button in the AI chat. */
  pinned: boolean;
}

/** The entry's text in the site language; English where a translation is missing. */
export function faqText(entry: FaqEntry, locale: Locale): { question: string; answer: string } {
  const question = entry.question[locale];
  const answer = entry.answer[locale];
  return question && answer ? { question, answer } : { question: entry.question.en, answer: entry.answer.en };
}

interface MockFaq {
  id: string;
  question: string;
  answer: string;
}

const sameInAll = (text: string): LocalizedText => ({ en: text, kz: text, ru: text });

/** Demo data for VITE_USE_MOCK_API (English only). */
export const FAQ_ENTRIES: FaqEntry[] = ([
  {
    id: "dean-office",
    question: "Where is the Dean's office?",
    answer:
      "Main Building, 2nd floor, room 205. Office hours: Mon–Fri, 9:00–17:00.",
  },
  {
    id: "ects",
    question: "What is the ECTS?",
    answer:
      "European Credit Transfer System — a standard way to measure course workload. 1 ECTS credit ≈ 25–30 hours of study.",
  },
  {
    id: "d116",
    question: "Where is the D116?",
    answer:
      "Block D, 1st floor, next to the main entrance. Follow the signs from the D-block lobby.",
  },
  {
    id: "course-registration",
    question: "How do I register for courses?",
    answer:
      'Log in to the student portal → "Course Registration" tab → select your semester → choose courses → confirm.',
  },
  {
    id: "library",
    question: "Where is the library?",
    answer:
      "Library, Block C, 3rd floor. Open 8:00–22:00 on weekdays, 10:00–18:00 on weekends.",
  },
] satisfies MockFaq[]).map((f) => ({
  id: f.id,
  question: sameInAll(f.question),
  answer: sameInAll(f.answer),
  category: "general",
  pinned: true,
}));
