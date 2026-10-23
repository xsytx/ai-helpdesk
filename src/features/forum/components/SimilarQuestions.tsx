import { useSimilarThreads } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import { CheckCircle2, Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const TYPING_PAUSE_MS = 400;

/**
 * Under the title of a new question: questions on the same topic that were
 * already asked, so the student can open one instead of asking again.
 * onOpen closes the dialog when one is opened.
 */
export function SimilarQuestions({ title, onOpen }: { title: string; onOpen: () => void }) {
  const { t, plural } = useLocale();
  const [settled, setSettled] = useState(title);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(title), TYPING_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [title]);
  const { data: similar = [] } = useSimilarThreads(settled);
  if (title.trim().length < 8 || similar.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3" aria-live="polite">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
        {t("similarAlreadyAsked")}
      </p>
      <ul className="space-y-1">
        {similar.slice(0, 3).map((thread) => (
          <li key={thread.id}>
            <Link
              to={`/forum/${thread.id}`}
              onClick={onOpen}
              className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1 text-sm text-primary hover:bg-white"
            >
              <span className="min-w-0 truncate font-medium">{thread.title}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-label">
                {thread.acceptedAnswerId ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" aria-label={t("solved")} /> : null}
                {plural(thread.answerCount, "replies")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
