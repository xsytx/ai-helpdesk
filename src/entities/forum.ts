import type { ReputationLevel } from "./reputation";
/** ok/checking = visible to everyone; held/rejected = hidden by moderation (author and moderators still see it). */
export type ModerationStatus = "ok" | "checking" | "held" | "rejected";

export interface Thread {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  body: string;
  createdAt: string;
  answerCount: number;
  /** Net upvotes on the thread itself. */
  score: number;
  /** Lowercase labels, e.g. "dorm" (shown as #dorm). */
  tags?: string[];
  moderationStatus?: ModerationStatus;
  /** The author's avatar ("" = initials). */
  authorAvatar?: string;
  /** The author's level (thread page only). */
  authorLevel?: ReputationLevel;
  authorPoints?: number;
  /** Photos (thread page only). */
  attachments?: { id: string; url: string }[];
  /** In lists: how many photos the question has, and the first few to preview. */
  photoCount?: number;
  previewPhotos?: string[];
  /** The answer the author marked as the solution ("Solved"). */
  acceptedAnswerId?: string;
  /** Search results only: where the words were found ("similar" = a near match, e.g. a typo). */
  searchMatch?: "title" | "body" | "answer" | "tag" | "similar";
}

export interface Answer {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  likes: number;
  likedByUserIds: string[];
  authorAvatar?: string;
  /** Photos in the answer. */
  attachments?: { id: string; url: string }[];
  /** The author's level (thread page only). */
  authorLevel?: ReputationLevel;
  authorPoints?: number;
  moderationStatus?: ModerationStatus;
  /** A reply under another answer (that answer's id); answers have none. */
  parentId?: string;
}

/** "unanswered": questions with no answer yet, newest first. */
export type ThreadSort = "top" | "newest" | "unanswered";
