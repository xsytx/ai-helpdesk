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

/** Waiting suggestions per student, and per student and place (maxPendingSuggestions, store.MaxSuggestionsPerPlace). */
const MAX_WAITING = 20;
const MAX_PER_PLACE = 5;

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

/**
 * "Add photos of this place": several at once (a few angles), sent one after
 * another with progress; the button stays, so more can follow.
 */
function SuggestPhoto({ placeCode, empty }: { placeCode: string; empty: boolean }) {
  const { t } = useLocale();
  const suggest = useSuggestLocationPhoto();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<TranslationKey>();
  const [sending, setSending] = useState<{ i: number; n: number }>();
  const [sent, setSent] = useState(0);

  const send = async (files: File[]) => {
    const { ok, problem: why } = checkPhotos(files, MAX_PER_PLACE);
    setProblem(why === "photoTooMany" ? "mapsSuggestPhotoMax" : why);
    let done = 0;
    for (const [i, file] of ok.entries()) {
      setSending({ i: i + 1, n: ok.length });
      try {
        await suggest.mutateAsync({ placeCode, file });
        done++;
      } catch (err) {
        setProblem(
          getErrorStatus(err) === 409 ? "mapsSuggestPhotoAlready"
          : getErrorData(err)?.code === "too_many_waiting" ? "mapsSuggestPhotoTooMany"
          : "mapsSuggestPhotoFailed",
        );
        break;
      }
    }
    setSending(undefined);
    setSent((n) => n + done);
  };

  const busy = sending !== undefined;
  const status = busy ? t("mapsSuggestPhotoSending").replace("{i}", String(sending.i)).replace("{n}", String(sending.n)) : null;
  const message = (
    <>
      {sent > 0 && !busy ? <p className="text-xs text-green-700" role="status">{t("mapsSuggestPhotoThanks").replace("{n}", String(sent))}</p> : null}
      {problem ? (
        <p className="text-xs text-error" role="alert">
          {t(problem).replace("{n}", String(problem === "mapsSuggestPhotoTooMany" ? MAX_WAITING : MAX_PER_PLACE))}
        </p>
      ) : null}
    </>
  );
  if (empty && sent === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border p-2.5">
        <AddPhotoButton onFiles={(f) => void send(f)} disabled={busy} />
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-label">{status ?? t("mapsSuggestPhotoEmpty")}</p>
          {message}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-brand hover:bg-background-2 disabled:opacity-50 dark:text-primary"
      >
        <ImagePlus className="h-3.5 w-3.5" />
        {status ?? t(sent > 0 ? "mapsSuggestPhotoMore" : "mapsSuggestPhoto")}
      </button>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          void send([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {message}
    </div>
  );
}
