import type { Thread } from "@/entities/forum";
import { useLocale } from "@/i18n/LocaleContext";
import { formatRelativeTime } from "@/shared/lib/format";
import { UserAvatar } from "@/features/profile/components/UserAvatar";
import { ChevronUp, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { TagChip } from "./TagInput";

export function ThreadCard({ thread }: { thread: Thread }) {
  const { locale, plural } = useLocale();
  const time = formatRelativeTime(thread.createdAt, locale);

  return (
    <li>
      <Link
        viewTransition
        to={`/forum/${thread.id}`}
        className="flex gap-3 rounded-xl p-2 transition-colors hover:bg-background-2/80"
      >
        <UserAvatar userId={thread.authorId} name={thread.authorName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-primary">{thread.authorName}</span>
            <span className="text-xs text-label">{time}</span>
          </div>
          <p className="mt-0.5 text-sm font-medium text-primary">{thread.title}</p>
          <p className="mt-1 line-clamp-2 text-sm text-primary/85">{thread.body}</p>
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
          </div>
        </div>
      </Link>
    </li>
  );
}
