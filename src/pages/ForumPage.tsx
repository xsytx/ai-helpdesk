import { CreateThreadDialog } from "@/features/forum/components/CreateThreadDialog";
import { FaqSearchMatches, SearchHelp } from "@/features/forum/components/SearchExtras";
import { TagChip } from "@/features/forum/components/TagInput";
import { FORUM_TAGS } from "@/features/forum/tags";
import { searchWords } from "@/shared/lib/highlight";
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

/** The address for a search or a set of topics (?tags=dorm,food). */
function listParams(q: string, tags: string[]): Record<string, string> {
  if (q) return { q };
  return tags.length ? { tags: tags.join(",") } : {};
}

export function ForumPage() {
  const { t } = useLocale();
  const [sort, setSort] = useState<ThreadSort>("top");
  const [createOpen, setCreateOpen] = useState(false);
  // Search and topics live in the address (/forum?q=… or /forum?tags=dorm,food),
  // so tag links work and "back" returns to the same list. ?tag= is the old form.
  const [params, setParams] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const tags = (params.get("tags") ?? params.get("tag") ?? "")
    .split(",")
    .filter((x): x is string => (FORUM_TAGS as readonly string[]).includes(x));
  const tagsKey = tags.join(",");
  const [input, setInput] = useState(q);
  const { data: threads = [], isLoading, isError, isPlaceholderData } = useThreads(sort, { q, tags: q ? undefined : tags });
  const trending = useTrendingTags().data ?? [];
  const uses = new Map(trending.map((x) => [x.name, x.count]));
  const tagsByUse = [...FORUM_TAGS].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0));
  const words = searchWords(q);

  // Follow address changes (a tag link, back/forward) in the search box.
  useEffect(() => setInput(q), [q]);

  // Typing updates the address after a short pause.
  useEffect(() => {
    const next = input.trim();
    if (next === q) return;
    const timer = window.setTimeout(() => {
      setParams(listParams(next, tagsKey ? tagsKey.split(",") : []), { replace: true });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [input, q, tagsKey, setParams]);

  const toggleTag = (name: string) =>
    setParams(listParams("", tags.includes(name) ? tags.filter((x) => x !== name) : [...tags, name]), { replace: true });

  const filtered = Boolean(q || tags.length);
  const emptyText = q
    ? t("forumSearchEmpty").replace("{q}", q)
    : tags.length
      ? t("forumTagEmpty")
      : sort === "unanswered"
        ? t("forumAllAnswered")
        : t("noThreadsYet");

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-primary">{t("discussionForum")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {!q ? <ThreadSortToggle sort={sort} onSortChange={setSort} withUnanswered /> : null}
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
                setParams(listParams("", tags), { replace: true });
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-label hover:bg-background-2 hover:text-primary"
              aria-label={t("forumClearFilter")}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {!q ? (
          // Every tag as a filter, the most used first; several = any of them.
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-label">{t("forumPopularTags")}</span>
            {tagsByUse.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={tags.includes(name)}
                onClick={() => toggleTag(name)}
                className="hover:opacity-80"
              >
                <TagChip tag={name} active={tags.includes(name)} />
              </button>
            ))}
            {tags.length ? (
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

        {q ? <FaqSearchMatches words={words} /> : null}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-label">{t("loading")}</p>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-error">{t("forumLoadFailed")}</p>
        ) : threads.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-sm text-label">{emptyText}</p>
            {!filtered && sort !== "unanswered" ? (
              <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("newQuestion")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className={isPlaceholderData ? "opacity-70 transition-opacity" : undefined}>
            <ThreadList threads={threads} highlightWords={words} />
          </div>
        )}
        {q && !isLoading ? <SearchHelp q={q} onAskForum={() => setCreateOpen(true)} /> : null}
      </Card>
      <CreateThreadDialog open={createOpen} onClose={() => setCreateOpen(false)} initialTitle={q} />
    </div>
  );
}
