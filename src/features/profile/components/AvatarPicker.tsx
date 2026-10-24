import { useAuth } from "@/app/AuthContext";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Avatar } from "@/shared/ui/Avatar";
import { Button } from "@/shared/ui/Button";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMyAvatar, useUpdateAvatar } from "../api";
import { MAX_AVATAR_BYTES, MAX_GIF_AVATAR_BYTES, PRESET_AVATARS, resolveAvatarSrc } from "../avatars";

const optionClass =
  "rounded-full ring-offset-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const selectedClass = "ring-2 ring-primary";

/** What is picked but not saved yet: a preset, or a photo from this device. */
type Draft = { preset: string } | { photo: File; preview: string };

/** Settings: choose a preset avatar or upload a photo. Saved to the account. */
export function AvatarPicker() {
  const { user } = useAuth();
  const { t } = useLocale();
  const saved = useMyAvatar();
  const updateAvatar = useUpdateAvatar();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>();
  const [fileError, setFileError] = useState<string>();
  const [done, setDone] = useState(false);

  // Free the preview of a chosen photo when it's replaced.
  const preview = draft && "photo" in draft ? draft.preview : undefined;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const savedIsPhoto = saved.startsWith("/uploads/") || saved.startsWith("data:");
  const shown = draft ? ("preset" in draft ? resolveAvatarSrc(draft.preset) : draft.preview) : resolveAvatarSrc(saved);
  const selectedPreset = draft ? ("preset" in draft ? draft.preset : undefined) : savedIsPhoto ? undefined : saved;
  const photoTile = preview ?? (savedIsPhoto ? saved : undefined);
  const photoSelected = draft ? "photo" in draft : savedIsPhoto;
  const isDirty = draft !== undefined && !("preset" in draft && draft.preset === saved);

  function pick(next: Draft | undefined) {
    setDraft(next);
    setDone(false);
    updateAvatar.reset();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setFileError(undefined);
    if (!file.type.startsWith("image/")) {
      setFileError(t("invalidImage"));
      return;
    }
    if (file.size > (file.type === "image/gif" ? MAX_GIF_AVATAR_BYTES : MAX_AVATAR_BYTES)) {
      setFileError(t("fileTooLarge"));
      return;
    }
    pick({ photo: file, preview: URL.createObjectURL(file) });
  }

  function handleSave() {
    if (!draft) return;
    updateAvatar.mutate("preset" in draft ? { preset: draft.preset } : { photo: draft.photo }, {
      onSuccess: () => {
        setDraft(undefined);
        setDone(true);
      },
    });
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar name={user?.name ?? ""} src={shown} className="h-16 w-16 text-lg" />
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-primary">{t("profilePicture")}</h2>
          <p className="text-sm text-label">{t("profilePictureHint")}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2 sm:gap-3" role="radiogroup" aria-label={t("profilePicture")}>
        {PRESET_AVATARS.map((preset, index) => {
          const isSelected = selectedPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${t("avatarOption")} ${index + 1}`}
              onClick={() => pick(preset.id === saved ? undefined : { preset: preset.id })}
              className={cn(optionClass, "hover:opacity-90", isSelected && selectedClass)}
            >
              <img src={preset.src} alt="" className="aspect-square w-full rounded-full bg-background-2" />
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        {photoTile ? (
          <button
            type="button"
            role="radio"
            aria-checked={photoSelected}
            aria-label={t("customPhoto")}
            onClick={() => (preview ? undefined : pick(undefined))}
            className={cn(optionClass, "shrink-0", photoSelected && selectedClass)}
          >
            <img src={photoTile} alt="" className="h-12 w-12 rounded-full object-cover" />
          </button>
        ) : null}
        <div className="min-w-0">
          <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {t("uploadPhoto")}
          </Button>
          <p className="mt-1 text-xs text-label">{t("uploadPhotoHint")}</p>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>

      {fileError ? (
        <p className="mt-2 text-xs text-error" role="alert">
          {fileError}
        </p>
      ) : null}
      {updateAvatar.isError ? (
        <p className="mt-3 text-sm text-error" role="alert">
          {t("avatarSaveFailed")}
        </p>
      ) : null}
      {done ? (
        <p className="mt-3 rounded-xl bg-background-2 px-3 py-2 text-sm text-primary" role="status">
          {t("avatarUpdated")}
        </p>
      ) : null}

      <Button type="button" className="mt-4 w-full" onClick={handleSave} disabled={!isDirty || updateAvatar.isPending}>
        {updateAvatar.isPending ? t("loading") : t("save")}
      </Button>
    </div>
  );
}
