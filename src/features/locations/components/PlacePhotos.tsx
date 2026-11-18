import { PhotoGallery, PhotoPicker } from "@/features/forum/components/Photos";
import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import { getErrorData, getErrorStatus } from "@/shared/api/client";
import { Button } from "@/shared/ui/Button";
import { ImagePlus, Send } from "lucide-react";
import { useState } from "react";
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
 * "Add photos of this place": chosen photos wait as previews (remove with ×,
 * add more with +, one at a time is fine) until "Send" — on Android a single
 * tap in the picker returns at once, so choosing must never mean sending.
 * They are sent one after another with progress; more can follow.
 */
function SuggestPhoto({ placeCode, empty }: { placeCode: string; empty: boolean }) {
  const { t } = useLocale();
  const suggest = useSuggestLocationPhoto();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<TranslationKey>();
  const [sending, setSending] = useState<{ i: number; n: number }>();
  const [sent, setSent] = useState(0);

  const send = async () => {
    setProblem(undefined);
    let done = 0;
    for (const [i, file] of files.entries()) {
      setSending({ i: i + 1, n: files.length });
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
    // What was sent leaves the tray; what failed stays, to try again.
    const rest = files.slice(done);
    setFiles(rest);
    if (rest.length === 0) setOpen(false);
  };

  const busy = sending !== undefined;
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

  if (open) {
    return (
      <div className="mt-2 space-y-2.5 rounded-xl border border-border p-3">
        <PhotoPicker files={files} onChange={setFiles} max={MAX_PER_PLACE} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || files.length === 0} onClick={() => void send()}>
            <Send className="h-4 w-4" />
            {busy
              ? t("mapsSuggestPhotoSending").replace("{i}", String(sending.i)).replace("{n}", String(sending.n))
              : t("mapsSuggestPhotoSend").replace("{n}", String(files.length))}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setFiles([]);
              setOpen(false);
              setProblem(undefined);
            }}
          >
            {t("cancel")}
          </Button>
        </div>
        {message}
      </div>
    );
  }
  const openTray = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-brand hover:bg-background-2 dark:text-primary"
    >
      <ImagePlus className="h-3.5 w-3.5" />
      {t(sent > 0 ? "mapsSuggestPhotoMore" : "mapsSuggestPhoto")}
    </button>
  );
  if (empty && sent === 0) {
    return (
      <div className="space-y-1 rounded-xl border border-dashed border-border p-2.5">
        <p className="text-xs text-label">{t("mapsSuggestPhotoEmpty")}</p>
        {openTray}
        {message}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      {openTray}
      {message}
    </div>
  );
}
