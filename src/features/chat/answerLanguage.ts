// The bot's knowledge base has many entries in one language only (e.g. a
// Russian answer about the copy centre). The search finds them from a question
// in any language and the AI explains them in the student's language, but
// the stored answer is quoted word for word. When the two are in different
// languages, the chat shows the explanation as the answer and folds the
// original away (AssistantContent), so an English question never gets a
// Russian reply on top.
import type { UiChatMessage } from "./api";

export type TextLang = "kz" | "ru" | "en";

/** The names of the languages as their speakers write them. */
export const LANG_NAME: Record<TextLang, string> = { kz: "Қазақша", ru: "Русский", en: "English" };

const KAZAKH = /[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/;

/** The language a text is written in, by its letters (undefined: too few letters to tell). */
export function textLang(text: string): TextLang | undefined {
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillic + latin < 8) return undefined;
  if (cyrillic > latin) return KAZAKH.test(text) ? "kz" : "ru";
  return "en";
}

/**
 * The stored source answer's language when it differs from the AI's
 * explanation (the reply language), else undefined. Kazakh and Russian
 * answers often mix both, so only clear differences count.
 */
export function sourceInOtherLanguage(msg: Pick<UiChatMessage, "forumAnswer" | "aiExplanation">): TextLang | undefined {
  if (!msg.forumAnswer || !msg.aiExplanation) return undefined;
  const source = textLang(msg.forumAnswer);
  const reply = textLang(msg.aiExplanation);
  return source && reply && source !== reply ? source : undefined;
}
