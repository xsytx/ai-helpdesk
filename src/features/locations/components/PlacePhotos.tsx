import { PHOTO_TYPES } from "@/features/forum/api";
import { AddPhotoButton, checkPhotos, PhotoGallery } from "@/features/forum/components/Photos";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { getErrorData, getErrorStatus } from "@/shared/api/client";
import { ImagePlus } from "lucide-react";
import { useRef, useState } from "react";
import { useMapPoints } from "../mapPoints";
import { photoCodesOfTarget, useLocationPhotos, useSuggestLocationPhoto } from "../photos";
import type { Place, RoomCode } from "../places";

/** Waiting suggestions per student (maxPendingSuggestions on the server). */
const MAX_WAITING = 5;

/**
 * The place card's photo gallery (Maps page): a click opens the full-size
 * viewer. Students may add a photo of the place; it shows after an admin
 * adds it to the gallery.
 */
export function PlacePhotos({ target }: { target: Place | RoomCode }) {
  const { t } = useLocale();
  const { data: points } = useMapPoints();
  const codes = points ? photoCodesOfTarget(target, points) : [];
  const { data: photos } = useLocationPhotos(codes);
  if (!photos) return null;
  return (
    <section>
      {photos.length > 0 ? (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-label">
            {t("mapsPhotos")} · {photos.length}
          </h3>
          <PhotoGallery photos={photos} />
        </>
      ) : null}
      <SuggestPhoto placeCode={codes[0]!} empty={photos.length === 0} />
    </section>
  );
}

function SuggestPhoto({ placeCode, empty }: { placeCode: string; empty: boolean }) {
  const { t } = useLocale();
  const suggest = useSuggestLocationPhoto();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<TranslationKey>();

  const send = (files: File[]) => {
    const { ok, problem: why } = checkPhotos(files, 1);
    setProblem(why === "photoTooMany" ? undefined : why);
    if (!ok[0]) return;
    suggest.mutate(
      { placeCode, file: ok[0] },
      {
        onError: (err) => {
          const status = getErrorStatus(err);
          setProblem(
            status === 409 ? "mapsSuggestPhotoAlready"
            : getErrorData(err)?.code === "too_many_waiting" ? "mapsSuggestPhotoTooMany"
            : "mapsSuggestPhotoFailed",
          );
        },
      },
    );
  };

  if (suggest.isSuccess) return <p className="mt-2 text-sm text-green-700">{t("mapsSuggestPhotoThanks")}</p>;

  const message = problem ? (
    <p className="text-xs text-error" role="alert">{t(problem).replace("{n}", String(MAX_WAITING))}</p>
  ) : null;
  if (empty) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border p-2.5">
        <AddPhotoButton onFiles={send} disabled={suggest.isPending} />
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-label">{suggest.isPending ? t("photoUploading") : t("mapsSuggestPhotoEmpty")}</p>
          {message}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      <button
        type="button"
        disabled={suggest.isPending}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-brand hover:bg-background-2 disabled:opacity-50 dark:text-primary"
      >
        <ImagePlus className="h-3.5 w-3.5" />
        {suggest.isPending ? t("photoUploading") : t("mapsSuggestPhoto")}
      </button>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(",")}
        hidden
        onChange={(e) => {
          send([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {message}
    </div>
  );
}
