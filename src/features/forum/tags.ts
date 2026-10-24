import type { TranslationKey } from "@/i18n/translations";

/**
 * The tags a question can have, chosen from this list (the backend accepts
 * only these: store.ForumTags in backend/internal/store/tags.go). Order =
 * the order they are offered in.
 */
export const FORUM_TAGS = [
  "dorm",
  "campus",
  "study",
  "exams",
  "schedule",
  "registration",
  "scholarship",
  "documents",
  "food",
  "student-life",
  "clubs",
  "it",
  "other",
] as const;

export type ForumTag = (typeof FORUM_TAGS)[number];

/** At most this many tags per question (store.MaxTagsPerThread). */
export const MAX_TAGS = 5;

const TAG_KEY: Record<ForumTag, TranslationKey> = {
  dorm: "tagDorm",
  campus: "tagCampus",
  study: "tagStudy",
  exams: "tagExams",
  schedule: "tagSchedule",
  registration: "tagRegistration",
  scholarship: "tagScholarship",
  documents: "tagDocuments",
  food: "tagFood",
  "student-life": "tagStudentLife",
  clubs: "tagClubs",
  it: "tagIt",
  other: "tagOther",
};

/** A tag's name in the site language ("#name" for an unknown one). */
export function tagLabel(tag: string, t: (key: TranslationKey) => string): string {
  return tag in TAG_KEY ? t(TAG_KEY[tag as ForumTag]) : `#${tag}`;
}
