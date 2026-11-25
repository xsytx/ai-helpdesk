// Ordering a curriculum's electives by their reviews (Courses page): the
// options of an elective slot and the elective lists. Required courses keep
// their place: there is nothing to choose there.
import type { ReviewBrief } from "./api";

export type ElectiveOrder = "" | "recommended" | "easiest" | "useful";

export const ELECTIVE_ORDERS: { id: ElectiveOrder; key: "coursesOrderPlan" | "coursesOrderRecommended" | "coursesOrderEasiest" | "coursesOrderUseful" }[] = [
  { id: "", key: "coursesOrderPlan" },
  { id: "recommended", key: "coursesOrderRecommended" },
  { id: "easiest", key: "coursesOrderEasiest" },
  { id: "useful", key: "coursesOrderUseful" },
];

export const asElectiveOrder = (v: string | null): ElectiveOrder =>
  v === "recommended" || v === "easiest" || v === "useful" ? v : "";

/** Bigger = earlier in the list. */
function score(r: ReviewBrief, order: ElectiveOrder): number {
  if (order === "easiest") return -r.difficulty;
  if (order === "useful") return r.usefulness;
  return r.recommend_pct;
}

/**
 * Courses with reviews first, best first (ties: more reviews first); those
 * without reviews after them in the plan's order. "" = the plan's order.
 */
export function orderByReviews<T extends { code: string }>(list: T[], ratings: Record<string, ReviewBrief> | undefined, order: ElectiveOrder): T[] {
  if (!order || !ratings) return list;
  const rated = list.filter((c) => (ratings[c.code]?.count ?? 0) > 0);
  const rest = list.filter((c) => !((ratings[c.code]?.count ?? 0) > 0));
  rated.sort((a, b) => {
    const ra = ratings[a.code]!;
    const rb = ratings[b.code]!;
    return score(rb, order) - score(ra, order) || rb.count - ra.count;
  });
  return [...rated, ...rest];
}
