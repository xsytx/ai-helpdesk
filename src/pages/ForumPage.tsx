import { CreateThreadDialog } from "@/features/forum/components/CreateThreadDialog";
import { TagChip } from "@/features/forum/components/TagInput";
import { ThreadList } from "@/features/forum/components/ThreadList";
import { ThreadSortToggle } from "@/features/forum/components/ThreadSortToggle";
import { useThreads, useTrendingTags } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { ThreadSort } from "@/entities/forum";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

const SEARCH_DELAY_MS = 300;

export function ForumPage() {
  const { t } = useLocale();
  const [sort, setSort] = useState<ThreadSort>("top");
  const [createOpen, setCreateOpen] = useState(false);
  // Search and tag live in the address (/forum?q=… or /forum?tag=…), so
  // tag links work and "back" returns to the same list.
  const [params, setParams] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const tag = params.get("tag") ?? "";
  const [input, setInput] = useState(q);
  const { data: threads = [], isLoading, isError, isPlaceholderData } = useThreads(sort, { q, tag: q ? undefined : tag });
  const trending = useTrendingTags().data ?? [];

  // Follow address changes (a tag link, back/forward) in the search box.
  useEffect(() => setInput(q), [q]);

  // Typing updates the address after a short pause.
  useEffect(() => {
    const next = input.trim();
    if (next === q) return;
    const timer = window.setTimeout(() => {
      setParams(next ? { q: next } : tag ? { tag } : {}, { replace: true });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [input, q, tag, setParams]);

  const filtered = Boolean(q || tag);
  const emptyText = q ? t("forumSearchEmpty").replace("{q}", q) : tag ? t("forumTagEmpty") : t("noThreadsYet");

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-primary">{t("discussionForum")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {!q && !tag ? <ThreadSortToggle sort={sort} onSortChange={setSort} /> : null}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("newQuestion")}
            </Button>
          </div>
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-label" aria-hidden />
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("forumSearchPlaceholder")}
            aria-label={t("forumSearchPlaceholder")}
            maxLength={200}
            className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-9 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {input ? (
            <button
              type="button"
              onClick={() => {
                setInput("");
                setParams(tag ? { tag } : {}, { replace: true });
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-label hover:bg-background-2 hover:text-primary"
              aria-label={t("forumClearFilter")}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {!q && (tag || trending.length > 0) ? (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-label">{t("forumPopularTags")}</span>
            {tag && !trending.some((x) => x.name === tag) ? (
              <button type="button" onClick={() => setParams({}, { replace: true })} aria-pressed>
                <TagChip tag={tag} active />
              </button>
            ) : null}
            {trending.map((x) => (
              <button
                key={x.name}
                type="button"
                aria-pressed={tag === x.name}
                onClick={() => setParams(tag === x.name ? {} : { tag: x.name }, { replace: true })}
                className="hover:opacity-80"
              >
                <TagChip tag={x.name} active={tag === x.name} />
              </button>
            ))}
            {tag ? (
              <button
                type="button"
                onClick={() => setParams({}, { replace: true })}
                className="inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-xs font-medium text-label hover:text-primary"
              >
                <X className="h-3 w-3" />
                {t("forumClearFilter")}
              </button>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-label">{t("loading")}</p>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-error">{t("forumLoadFailed")}</p>
        ) : threads.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-label">{emptyText}</p>
            {!filtered ? (
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("newQuestion")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className={isPlaceholderData ? "opacity-70 transition-opacity" : undefined}>
            <ThreadList threads={threads} />
          </div>
        )}
      </Card>
      <CreateThreadDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
