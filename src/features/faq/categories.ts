import type { FaqCategory } from "@/entities/faq";
import type { TranslationKey } from "@/i18n/translations";

/** Translation key of each FAQ category's name. */
export const FAQ_CATEGORY_KEY: Record<FaqCategory, TranslationKey> = {
  general: "faqCategoryGeneral",
  account: "faqCategoryAccount",
  study: "faqCategoryStudy",
  campus: "faqCategoryCampus",
  forum: "faqCategoryForum",
};
