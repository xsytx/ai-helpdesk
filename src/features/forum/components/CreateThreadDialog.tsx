import { useAuth } from "@/app/AuthContext";
import { useCreateThread } from "@/features/forum/api";
import { ModerationNoticeCard } from "@/features/moderation/components/ModerationNoticeCard";
import type { ModerationNotice } from "@/features/moderation/notice";
import { useLocale } from "@/i18n/LocaleContext";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { X } from "lucide-react";
import { SimilarQuestions } from "./SimilarQuestions";
import { PhotoPicker } from "./Photos";
import { uploadPhoto } from "@/features/forum/api";
import { TagPicker } from "./TagInput";
import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

/** initialTitle: prefilled title, e.g. the search that found nothing. */
export function CreateThreadDialog({
  open,
  onClose,
  initialTitle = "",
}: {
  open: boolean;
  onClose: () => void;
  initialTitle?: string;
}) {
  const { user } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const createThread = useCreateThread();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<ModerationNotice>();

  useEffect(() => {
    if (!open) {
      setTitle("");
      setBody("");
      setTags([]);
      setPhotos([]);
      setError(undefined);
      setNotice(undefined);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Prefill once when the dialog opens (not on every re-render of the page,
  // which would overwrite what the student is typing).
  useEffect(() => {
    if (open && initialTitle) setTitle(initialTitle);
  }, [open, initialTitle]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (title.trim().length < 5) {
      setError(t("threadTitleTooShort"));
      return;
    }
    if (body.trim().length < 10) {
      setError(t("threadBodyTooShort"));
      return;
    }
    setError(undefined);
    try {
      const result = await createThread.mutateAsync({
        authorId: user.id,
        authorName: user.name,
        title,
        body,
        tags,
      });
      if (result.kind === "pending") {
        // Not published yet: tell the author instead of opening a thread that does not exist.
        setNotice(result.notice);
        return;
      }
      // Photos go up once the question exists; one that fails doesn't stop the rest.
      if (photos.length > 0) {
        setUploading(true);
        for (const photo of photos) {
          await uploadPhoto(result.thread.id, photo).catch(() => undefined);
        }
        setUploading(false);
      }
      onClose();
      navigate(`/forum/${result.thread.id}`, { viewTransition: true });
    } catch {
      setError(t("threadCreateFailed"));
    }
  }

  // Rendered on <body> so the overlay covers the whole app, header included:
  // the page area is its own layer (for page transitions) and would trap it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand/30 dark:bg-black/60 p-4 sm:items-center">
      <div
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-thread-title"
        // Never taller than the screen: the fields scroll, the buttons stay at the bottom.
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-2xl bg-surface p-5 shadow-xl md:p-6"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 id="create-thread-title" className="text-lg font-bold text-primary">
            {t("newQuestion")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-label hover:bg-background-2"
            aria-label={t("close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {notice ? (
          <div className="min-h-0 space-y-4 overflow-y-auto">
            <ModerationNoticeCard notice={notice} />
            <Button type="button" className="w-full" onClick={onClose}>
              {t("close")}
            </Button>
          </div>
        ) : (
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-1 pb-1">
          <Input
            label={t("threadTitle")}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("threadTitlePlaceholder")}
            maxLength={120}
          />
          <SimilarQuestions title={title} onOpen={onClose} />
          <div className="space-y-1.5">
            <label htmlFor="thread-body" className="text-sm font-medium text-label">
              {t("threadDetails")}
            </label>
            <textarea
              id="thread-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("threadBodyPlaceholder")}
              rows={4}
              maxLength={2000}
              className="w-full resize-y rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </div>
          <TagPicker id="thread-tags" tags={tags} onChange={setTags} />
          <PhotoPicker files={photos} onChange={setPhotos} />
          {error ? (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          ) : null}
          </div>
          <div className="mt-3 flex shrink-0 gap-2 border-t border-border/50 pt-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="flex-1" disabled={createThread.isPending || uploading}>
              {uploading ? t("photoUploading") : createThread.isPending ? "…" : t("postQuestion")}
            </Button>
          </div>
        </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
