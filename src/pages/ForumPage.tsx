import { CreateThreadDialog } from "@/features/forum/components/CreateThreadDialog";
import { ThreadList } from "@/features/forum/components/ThreadList";
import { ThreadSortToggle } from "@/features/forum/components/ThreadSortToggle";
import { useThreads } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { ThreadSort } from "@/entities/forum";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Plus } from "lucide-react";
import { useState } from "react";

export function ForumPage() {
  const { t } = useLocale();
  const [sort, setSort] = useState<ThreadSort>("top");
  const [createOpen, setCreateOpen] = useState(false);
  const { data: threads = [], isLoading, isError } = useThreads(sort);

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-primary">{t("discussionForum")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ThreadSortToggle sort={sort} onSortChange={setSort} />
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("newQuestion")}
            </Button>
          </div>
        </div>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-label">{t("loading")}</p>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-error">{t("forumLoadFailed")}</p>
        ) : threads.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-label">{t("noThreadsYet")}</p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("newQuestion")}
            </Button>
          </div>
        ) : (
          <ThreadList threads={threads} />
        )}
      </Card>
      <CreateThreadDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
