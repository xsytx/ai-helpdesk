import { useAuth } from "@/app/AuthContext";
import { useCreateThread } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export function CreateThreadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const createThread = useCreateThread();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) {
      setTitle("");
      setBody("");
      setError(undefined);
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
      const thread = await createThread.mutateAsync({
        authorId: user.id,
        authorName: user.name,
        title,
        body,
      });
      onClose();
      navigate(`/forum/${thread.id}`);
    } catch {
      setError(t("threadCreateFailed"));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-primary/30 p-4 sm:items-center">
      <div
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-thread-title"
        className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl md:p-6"
      >
        <div className="mb-4 flex items-center justify-between">
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
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label={t("threadTitle")}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("threadTitlePlaceholder")}
            maxLength={120}
          />
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
              className="w-full resize-y rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-primary placeholder:text-grey focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </div>
          {error ? (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="flex-1" disabled={createThread.isPending}>
              {createThread.isPending ? "…" : t("postQuestion")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
