import { MAX_ORIGINAL_PHOTO_BYTES, MAX_PHOTO_BYTES, MAX_PHOTOS, PHOTO_TYPES } from "@/features/forum/api";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Splits chosen files into ones that may be uploaded and the reason the rest can't. */
export function checkPhotos(files: File[], room: number): { ok: File[]; problem?: TranslationKey } {
  const ok: File[] = [];
  let problem: TranslationKey | undefined;
  for (const f of files) {
    if (!PHOTO_TYPES.includes(f.type)) problem = "photoWrongType";
    // Photos are shrunk before upload; GIFs aren't, so they must already be small.
    else if (f.size > (f.type === "image/gif" ? MAX_PHOTO_BYTES : MAX_ORIGINAL_PHOTO_BYTES)) problem = "photoTooBig";
    else if (ok.length >= room) problem = "photoTooMany";
    else ok.push(f);
  }
  return { ok, problem };
}

/** The "add photo" tile: opens the file picker (several files at once). */
export function AddPhotoButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const { t } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="flex aspect-square w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-label transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-50"
      >
        <ImagePlus className="h-5 w-5" aria-hidden />
        <span className="text-[10px] font-semibold">{t("photoAdd")}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** A photo tile with a remove button. */
export function PhotoThumb({ src, onRemove, label }: { src: string; onRemove?: () => void; label: string }) {
  const { t } = useLocale();
  return (
    <div className="relative aspect-square w-20 overflow-hidden rounded-xl border border-border/60 bg-background-2">
      <img src={src} alt={label} className="h-full w-full object-cover" />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("photoRemove")}
          className="absolute right-1 top-1 rounded-full bg-primary/80 p-0.5 text-white hover:bg-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** New question: photos chosen on this device, uploaded after the question is posted. */
export function PhotoPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const { t } = useLocale();
  const [problem, setProblem] = useState<TranslationKey>();
  // Previews of local files; freed when they're no longer shown.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-label">{t("photosLabel")}</p>
      <div className="flex flex-wrap gap-2">
        {previews.map((src, i) => (
          <PhotoThumb key={src} src={src} label={files[i]?.name ?? ""} onRemove={() => onChange(files.filter((_, j) => j !== i))} />
        ))}
        {files.length < MAX_PHOTOS ? (
          <AddPhotoButton
            onFiles={(chosen) => {
              const { ok, problem } = checkPhotos(chosen, MAX_PHOTOS - files.length);
              setProblem(problem);
              if (ok.length) onChange([...files, ...ok]);
            }}
          />
        ) : null}
      </div>
      {problem ? <p className="text-xs text-error">{t(problem)}</p> : <p className="text-xs text-label">{t("photosHint")}</p>}
    </div>
  );
}

/** A question's photos as a grid; a click opens them full size. */
export function PhotoGallery({ photos }: { photos: { id: string; url: string }[] }) {
  const { t } = useLocale();
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={`${t("photoOpen")} ${i + 1}`}
            className="h-28 w-28 overflow-hidden rounded-xl border border-border/60 bg-background-2 transition-opacity hover:opacity-90 sm:h-32 sm:w-32"
          >
            <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {open !== null ? <Lightbox photos={photos} start={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Lightbox({ photos, start, onClose }: { photos: { id: string; url: string }[]; start: number; onClose: () => void }) {
  const { t } = useLocale();
  const [i, setI] = useState(start);
  const go = (by: number) => setI((x) => (x + by + photos.length) % photos.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((x) => (x + 1) % photos.length);
      else if (e.key === "ArrowLeft") setI((x) => (x - 1 + photos.length) % photos.length);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, photos.length]);

  // On <body>: the page area is its own layer (page transitions) and would trap it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("photoOpen")}
      onClick={onClose}
    >
      <img
        src={photos[i]!.url}
        alt=""
        className="max-h-[85dvh] max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {photos.length > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            aria-label={t("photoPrevious")}
            className="absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            aria-label={t("photoNext")}
            className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <p className="absolute bottom-4 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
            {i + 1} / {photos.length}
          </p>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
