import { plainText } from "@/shared/ui/RichText";
import type { Thread } from "@/entities/forum";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { formatRelativeTime } from "@/shared/lib/format";
import { highlight, snippetAround } from "@/shared/lib/highlight";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { CheckCircle2, ChevronUp, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { TagChip } from "./TagInput";

// Search results found outside the title and text say where.
const MATCH_LABEL: Partial<Record<NonNullable<Thread["searchMatch"]>, TranslationKey>> = {
  answer: "searchFoundInAnswers",
  tag: "searchFoundByTag",
  similar: "searchSimilar",
};

export function ThreadCard({ thread, highlightWords = [] }: { thread: Thread; highlightWords?: string[] }) {
  const { locale, plural, t } = useLocale();
  const time = formatRelativeTime(thread.createdAt, locale);
  const matchLabel = thread.searchMatch ? MATCH_LABEL[thread.searchMatch] : undefined;
  const text = plainText(thread.body);
  const body = highlightWords.length > 0 ? snippetAround(text, highlightWords) : text;

  return (
    <li>
      <Link
        viewTransition
        to={`/forum/${thread.id}`}
        className="flex gap-3 rounded-xl p-2 transition-colors hover:bg-background-2/80"
      >
        <UserAvatar userId={thread.authorId} name={thread.authorName} avatar={thread.authorAvatar} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-primary">{thread.authorName}</span>
            <span className="text-xs text-label">{time}</span>
            {matchLabel ? (
              <span className="rounded-full bg-background-2 px-2 py-0.5 text-[11px] font-medium text-label">{t(matchLabel)}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm font-medium text-primary">{highlight(thread.title, highlightWords)}</p>
          <p className="mt-1 line-clamp-2 text-sm text-primary/85">{highlight(body, highlightWords)}</p>
          <PhotoPreview photos={thread.previewPhotos ?? []} total={thread.photoCount ?? 0} />
          {thread.tags && thread.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {thread.tags.map((tag) => (
                <TagChip key={tag} tag={tag} />
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-3 text-xs text-label">
            <span className="inline-flex items-center gap-1">
              <ChevronUp className="h-3.5 w-3.5" />
              {thread.score}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" />
              {plural(thread.answerCount, "replies")}
            </span>
            {thread.acceptedAnswerId ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("solved")}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

/**
 * The question's photos in the list, so you see them before opening it: one
 * photo as a wide preview, more as small squares, "+N" for the rest.
 */
function PhotoPreview({ photos, total }: { photos: string[]; total: number }) {
  const { plural } = useLocale();
  if (photos.length === 0) return null;
  const more = total - photos.length;
  return (
    <div className="mt-2 flex gap-1.5" role="img" aria-label={plural(total, "photosCount")}>
      {photos.map((src, i) => {
        const last = i === photos.length - 1;
        return (
          <div
            key={src}
            className={
              photos.length === 1
                ? "relative h-36 w-full max-w-sm overflow-hidden rounded-xl bg-background-2"
                : "relative h-20 w-20 overflow-hidden rounded-lg bg-background-2 sm:h-24 sm:w-24"
            }
          >
            <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
            {last && more > 0 ? (
              <span className="absolute inset-0 flex items-center justify-center bg-brand/55 text-sm font-bold text-white">
                +{more}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
