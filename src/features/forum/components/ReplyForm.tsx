import { useAuth } from "@/app/AuthContext";
import { useCreateAnswer } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import { Button } from "@/shared/ui/Button";
import { FormEvent, useState } from "react";

export function ReplyForm({ threadId }: { threadId: string }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const createAnswer = useCreateAnswer(threadId);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (body.trim().length < 5) {
      setError(t("answerTooShort"));
      return;
    }
    setError(undefined);
    try {
      await createAnswer.mutateAsync({
        authorId: user.id,
        authorName: user.name,
        body,
      });
      setBody("");
    } catch {
      setError(t("answerPostFailed"));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label htmlFor="reply-body" className="text-sm font-medium text-label">
        {t("yourAnswer")}
      </label>
      <textarea
        id="reply-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("answerPlaceholder")}
        rows={3}
        maxLength={2000}
        className="w-full resize-y rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      />
      {error ? (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={createAnswer.isPending}>
        {createAnswer.isPending ? "…" : t("postAnswer")}
      </Button>
    </form>
  );
}
