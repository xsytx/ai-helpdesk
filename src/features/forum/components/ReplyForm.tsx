import { PostEditor } from "./PostEditor";
import { useAuth } from "@/app/AuthContext";
import { MAX_ANSWER_PHOTOS, uploadAnswerPhoto, useCreateAnswer, forumKeys } from "@/features/forum/api";
import { PhotoPicker } from "./Photos";
import { useQueryClient } from "@tanstack/react-query";
import { ModerationNoticeCard } from "@/features/moderation/components/ModerationNoticeCard";
import type { ModerationNotice } from "@/features/moderation/notice";
import { useLocale } from "@/i18n/LocaleContext";
import { Button } from "@/shared/ui/Button";
import { FormEvent, useState } from "react";

/** Who a reply answers: it goes under answerId and starts with @authorName. */
export interface ReplyTarget {
  answerId: string;
  authorId: string;
  authorName: string;
}

/** A saved mention of the person replied to (the editor shows it as "@Name"). */
function mentionOf(target: ReplyTarget): string {
  return `@[${target.authorName.replace(/[[\]\n]/g, "").trim().slice(0, 80)}](u${target.authorId}) `;
}

/**
 * The answer form under a question, or (with replyTo) the small reply box
 * under an answer: no photos, a cancel button, closes when posted.
 */
export function ReplyForm({
  threadId,
  replyTo,
  onDone,
}: {
  threadId: string;
  replyTo?: ReplyTarget;
  onDone?: () => void;
}) {
  const { user } = useAuth();
  const { t } = useLocale();
  const createAnswer = useCreateAnswer(threadId);
  const startText = replyTo && replyTo.authorId !== user?.id ? mentionOf(replyTo) : "";
  const [body, setBody] = useState(startText);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<ModerationNotice>();
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const qc = useQueryClient();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    // A reply may be short ("thanks!"), but not just the @name.
    const own = (replyTo ? body.replace(startText, "") : body).trim();
    if (own.length < (replyTo ? 2 : 5)) {
      setError(t(replyTo ? "replyTooShort" : "answerTooShort"));
      return;
    }
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await createAnswer.mutateAsync({
        authorId: user.id,
        authorName: user.name,
        body,
        parentId: replyTo?.answerId,
      });
      if (replyTo && result.kind === "published") {
        onDone?.();
        return;
      }
      // The text is saved for the moderators either way, so the box is cleared.
      setNotice(result.kind === "pending" ? result.notice : undefined);
      setBody(replyTo ? startText : "");
      // Photos go up once the answer exists (a held-back answer has none yet).
      if (result.kind === "published" && photos.length > 0) {
        setUploading(true);
        for (const photo of photos) {
          await uploadAnswerPhoto(result.answer.id, photo).catch(() => undefined);
        }
        setUploading(false);
        void qc.invalidateQueries({ queryKey: forumKeys.thread(threadId) });
      }
      setPhotos([]);
    } catch {
      setError(t("answerPostFailed"));
    }
  }

  if (replyTo) {
    return (
      <form onSubmit={handleSubmit} className="mt-2 space-y-2">
        <PostEditor
          ariaLabel={t("replyTo").replace("{name}", replyTo.authorName)}
          value={body}
          onChange={setBody}
          placeholder={t("replyPlaceholder")}
          rows={2}
          autoFocus
        />
        {notice ? <ModerationNoticeCard notice={notice} /> : null}
        {error ? (
          <p className="text-xs text-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={createAnswer.isPending}>
            {createAnswer.isPending ? "…" : t("replySend")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onDone}>
            {notice ? t("close") : t("cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label htmlFor="reply-body" className="text-sm font-medium text-label">
        {t("yourAnswer")}
      </label>
      <PostEditor id="reply-body" value={body} onChange={setBody} placeholder={t("answerPlaceholder")} rows={3} />
      <PhotoPicker files={photos} onChange={setPhotos} max={MAX_ANSWER_PHOTOS} />
      {notice ? <ModerationNoticeCard notice={notice} /> : null}
      {error ? (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={createAnswer.isPending || uploading}>
        {uploading ? t("photoUploading") : createAnswer.isPending ? "…" : t("postAnswer")}
      </Button>
    </form>
  );
}
