import { useAuth } from "@/app/AuthContext";
import { MAX_ANSWER_PHOTOS, uploadAnswerPhoto, useCreateAnswer, forumKeys } from "@/features/forum/api";
import { PhotoPicker } from "./Photos";
import { useQueryClient } from "@tanstack/react-query";
import { ModerationNoticeCard } from "@/features/moderation/components/ModerationNoticeCard";
import type { ModerationNotice } from "@/features/moderation/notice";
import { useLocale } from "@/i18n/LocaleContext";
import { Button } from "@/shared/ui/Button";
import { FormEvent, useState } from "react";

export function ReplyForm({ threadId }: { threadId: string }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const createAnswer = useCreateAnswer(threadId);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<ModerationNotice>();
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const qc = useQueryClient();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (body.trim().length < 5) {
      setError(t("answerTooShort"));
      return;
    }
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await createAnswer.mutateAsync({
        authorId: user.id,
        authorName: user.name,
        body,
      });
      // The text is saved for the moderators either way, so the box is cleared.
      setNotice(result.kind === "pending" ? result.notice : undefined);
      setBody("");
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
        className="w-full resize-y rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      />
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
