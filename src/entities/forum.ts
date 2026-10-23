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
  moderationStatus?: ModerationStatus;
}

export type ThreadSort = "top" | "newest";
