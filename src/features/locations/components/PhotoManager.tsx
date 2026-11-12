// Admin: a place's photo gallery in the map editor (upload, caption, order,
// delete), and a student's report photo with "Add to gallery".
import { AddPhotoButton, checkPhotos, Lightbox } from "@/features/forum/components/Photos";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { getErrorStatus } from "@/shared/api/client";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Check, ChevronLeft, ChevronRight, ImagePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { LocationReport } from "../api";
import {
  MAX_PHOTO_CAPTION, MAX_PLACE_PHOTOS, useApproveLocationPhoto, useDeleteLocationPhoto, useLocationPhotos, useReorderLocationPhotos,
  useUpdatePhotoCaption, useUploadLocationPhoto, type LocationPhoto,
} from "../photos";

/**
 * The photos of one place. New photos go under codes[0]; photos stored under
 * the other codes are shown on the same card on the Maps page, so they are
 * listed too (delete only).
 */
export function PhotoManager({ codes, title }: { codes: string[]; title: string }) {
  const { t } = useLocale();
  const { data: photos, isPending } = useLocationPhotos(codes);
  const upload = useUploadLocationPhoto();
  const reorder = useReorderLocationPhotos();
  const remove = useDeleteLocationPhoto();
  const [problem, setProblem] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const main = codes[0]!;
  const own = (photos ?? []).filter((p) => p.placeCode === main);
  const other = (photos ?? []).filter((p) => p.placeCode !== main);
  const busy = uploading || reorder.isPending || remove.isPending;
  const failed = (err: unknown) => setProblem(getErrorStatus(err) === 409 ? t("mapPhotosFull").replace("{n}", String(MAX_PLACE_PHOTOS)) : t("mapPhotosFailed"));

  const add = async (files: File[]) => {
    const { ok, problem: why } = checkPhotos(files, MAX_PLACE_PHOTOS - own.length);
    setProblem(why ? t(why).replace("{n}", String(MAX_PLACE_PHOTOS)) : undefined);
    setUploading(true);
    try {
      for (const file of ok) await upload.mutateAsync({ placeCode: main, file });
    } catch (err) {
      failed(err);
    } finally {
      setUploading(false);
    }
  };
  const move = (i: number, by: -1 | 1) => {
    const ids = own.map((p) => p.id);
    [ids[i], ids[i + by]] = [ids[i + by]!, ids[i]!];
    setProblem(undefined);
    reorder.mutate({ placeCode: main, ids }, { onError: failed });
  };
  const del = (p: LocationPhoto) => {
    if (!window.confirm(t("mapPhotosDeleteConfirm"))) return;
    setProblem(undefined);
    remove.mutate(p.id, { onError: failed });
  };
  const all = [...own, ...other];

  return (
    <section className="space-y-2.5 rounded-2xl border border-border bg-surface p-3" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-semibold text-primary">{title}</p>
        <span className="shrink-0 font-mono text-[11px] text-label">{main}</span>
      </div>
      {isPending ? <p className="text-sm text-label">{t("loading")}</p> : null}
      {photos && all.length === 0 ? <p className="text-xs text-label">{t("mapPhotosEmpty")}</p> : null}
      <ul className="space-y-2">
        {own.map((p, i) => (
          <PhotoRow
            key={p.id}
            photo={p}
            onOpen={() => setOpen(all.indexOf(p))}
            onEarlier={i > 0 ? () => move(i, -1) : undefined}
            onLater={i < own.length - 1 ? () => move(i, 1) : undefined}
            onDelete={() => del(p)}
            busy={busy}
          />
        ))}
      </ul>
      {own.length < MAX_PLACE_PHOTOS ? (
        <div className="flex items-center gap-3">
          <AddPhotoButton onFiles={(files) => void add(files)} disabled={busy} />
          <p className="text-xs text-label">
            {uploading ? t("photoUploading") : t("mapPhotosHint").replace("{n}", String(MAX_PLACE_PHOTOS))}
          </p>
        </div>
      ) : null}
      {other.length > 0 ? (
        <div className="space-y-2 border-t border-border/60 pt-2">
          <p className="text-xs font-semibold text-label">{t("mapPhotosOther")}</p>
          <ul className="space-y-2">
            {other.map((p) => (
              <PhotoRow key={p.id} photo={p} onOpen={() => setOpen(all.indexOf(p))} onDelete={() => del(p)} busy={busy} />
            ))}
          </ul>
        </div>
      ) : null}
      {problem ? <p className="text-xs text-error" role="alert">{problem}</p> : null}
      {open !== null && all[open] ? <Lightbox photos={all} start={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function PhotoRow({ photo, onOpen, onEarlier, onLater, onDelete, busy }: {
  photo: LocationPhoto;
  onOpen: () => void;
  onEarlier?: () => void;
  onLater?: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useLocale();
  const save = useUpdatePhotoCaption();
  const [caption, setCaption] = useState(photo.caption);
  const [saved, setSaved] = useState(false);
  const commit = () => {
    const next = caption.trim();
    if (next === photo.caption) return;
    save.mutate({ id: photo.id, caption: next }, { onSuccess: () => setSaved(true) });
  };
  const icon = "h-7 w-7 px-0";
  return (
    <li className="flex gap-2">
      <button type="button" onClick={onOpen} aria-label={t("photoOpen")} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-background-2">
        <img src={photo.url} alt={photo.caption} loading="lazy" className="h-full w-full object-cover" />
      </button>
      <div className="min-w-0 flex-1 space-y-1">
        <input
          value={caption}
          maxLength={MAX_PHOTO_CAPTION}
          onChange={(e) => {
            setCaption(e.target.value);
            setSaved(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={t("mapPhotosCaption")}
          aria-label={t("mapPhotosCaption")}
          className={cn(
            "w-full rounded-lg border bg-surface px-2 py-1 text-xs text-primary outline-none placeholder:text-label/70 focus:border-brand",
            save.isError ? "border-error" : "border-border",
          )}
        />
        <div className="flex items-center gap-0.5">
          {onEarlier || onLater ? (
            <>
              <Button size="sm" variant="ghost" className={icon} disabled={busy || !onEarlier} onClick={onEarlier} aria-label={t("mapPhotosEarlier")} title={t("mapPhotosEarlier")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" className={icon} disabled={busy || !onLater} onClick={onLater} aria-label={t("mapPhotosLater")} title={t("mapPhotosLater")}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="ghost" className={icon} disabled={busy} onClick={onDelete} aria-label={t("photoRemove")} title={t("photoRemove")}>
            <Trash2 className="h-4 w-4" />
          </Button>
          {saved && !save.isPending ? <Check className="ml-1 h-3.5 w-3.5 text-green-700" aria-label={t("mapEditorSaved")} /> : null}
          {save.isError ? <span className="ml-1 text-[11px] text-error">{t("mapPhotosFailed")}</span> : null}
        </div>
      </div>
    </li>
  );
}

/** A report's photo for admins: open it, add it to the place's gallery, or remove it. */
export function ReportPhoto({ report }: { report: LocationReport }) {
  const { t } = useLocale();
  const approve = useApproveLocationPhoto();
  const remove = useDeleteLocationPhoto();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<TranslationKey>();
  const photo = report.photo;
  if (!photo) return null;
  const pending = photo.status === "pending";
  const busy = approve.isPending || remove.isPending;
  return (
    <div className="mt-2 flex items-start gap-2.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("mapReportPhoto")}
        className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-background-2"
      >
        <img src={photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
      </button>
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-semibold text-label">{t("mapReportPhoto")}</p>
        {pending ? (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-8 px-2.5"
              disabled={busy}
              onClick={() => approve.mutate({ id: photo.id }, { onError: (err) => setProblem(getErrorStatus(err) === 409 ? "mapPhotosFull" : "mapPhotosFailed") })}
            >
              <ImagePlus className="h-4 w-4" />
              {t("mapReportPhotoApprove")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2.5"
              disabled={busy}
              onClick={() => remove.mutate(photo.id, { onError: () => setProblem("mapPhotosFailed") })}
            >
              <Trash2 className="h-4 w-4" />
              {t("mapReportPhotoRemove")}
            </Button>
          </div>
        ) : (
          <p className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
            <Check className="h-3.5 w-3.5" />
            {t("mapReportPhotoInGallery")}
          </p>
        )}
        {problem ? <p className="text-xs text-error">{t(problem).replace("{n}", String(MAX_PLACE_PHOTOS))}</p> : null}
      </div>
      {open ? <Lightbox photos={[{ id: photo.id, url: photo.url }]} start={0} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
