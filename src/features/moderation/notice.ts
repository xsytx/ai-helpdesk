// What the backend answers (HTTP 202) when a new question/answer was NOT published right away.
// Kept in its own file (no imports) so the forum code and the moderation code can both use it.

export type ModerationDecision = "block" | "review";

export interface ModerationNotice {
  decision: ModerationDecision;
  categories: string[];
  queueId: number;
}

interface ApiModerationNotice {
  status: "pending_moderation";
  decision: ModerationDecision;
  categories?: string[];
  queue_id: number;
}

/** Returns the notice if the response says "held for moderation", otherwise null (= it was published). */
export function parseModerationNotice(data: unknown): ModerationNotice | null {
  const d = data as Partial<ApiModerationNotice> | null;
  if (!d || d.status !== "pending_moderation") return null;
  return {
    decision: d.decision === "block" ? "block" : "review",
    categories: d.categories ?? [],
    queueId: d.queue_id ?? 0,
  };
}
