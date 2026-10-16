import { useThreads } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import { Card } from "@/shared/ui/Card";
import { Link } from "react-router-dom";
import { useState } from "react";
import type { ThreadSort } from "@/entities/forum";
import { ThreadSortToggle } from "./ThreadSortToggle";
import { ThreadList } from "./ThreadList";

export function ForumPreview() {
  const { t } = useLocale();
  const [sort, setSort] = useState<ThreadSort>("top");
  const { data: threads = [], isLoading } = useThreads(sort);
  const preview = threads.slice(0, 3);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-primary">
          <Link viewTransition to="/forum" className="hover:underline">
            {t("discussionForum")}
          </Link>
        </h3>
        <ThreadSortToggle sort={sort} onSortChange={setSort} />
      </div>
      {isLoading ? (
        <p className="text-sm text-label">{t("loading")}</p>
      ) : (
        <ThreadList threads={preview} />
      )}
      {threads.length > 3 ? (
        <Link
          viewTransition
          to="/forum"
          className="mt-3 inline-block text-sm font-medium text-primary-light hover:underline"
        >
          {t("viewAllThreads")}
        </Link>
      ) : null}
    </Card>
  );
}
