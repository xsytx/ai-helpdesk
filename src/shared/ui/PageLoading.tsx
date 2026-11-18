import { PageSkeleton } from "@/shared/ui/Skeleton";

/** Shown while a page's code is being downloaded: Barys and the page's shape. */
export function PageLoading() {
  return <PageSkeleton className="mx-auto max-w-3xl py-2" />;
}
