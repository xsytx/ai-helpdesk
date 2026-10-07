import { useAuth } from "@/app/AuthContext";
import { useLocale } from "@/i18n/LocaleContext";
import { cn } from "@/shared/lib/cn";
import { Avatar } from "@/shared/ui/Avatar";
import { Button } from "@/shared/ui/Button";
import { Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { useUpdateAvatar, useUserAvatar } from "../api";
import { MAX_AVATAR_BYTES, PRESET_AVATARS, readFileAsDataUrl, resolveAvatarSrc } from "../avatars";

const optionClass =
  "rounded-full ring-offset-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const selectedClass = "ring-2 ring-primary";

export function AvatarPicker() {
  const { user } = useAuth();
  const { t } = useLocale();
  const { data: savedAvatarId } = useUserAvatar();
  const updateAvatar = useUpdateAvatar();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // undefined = untouched, follow whatever is saved
  const [draft, setDraft] = useState<string>();
  const [customDataUrl, setCustomDataUrl] = useState<string>();
  const [fileError, setFileError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const selected = draft ?? savedAvatarId ?? undefined;
  const customPreview =
    customDataUrl ?? (savedAvatarId?.startsWith("data:") ? savedAvatarId : undefined);
  const isDirty = draft !== undefined && draft !== savedAvatarId;

  function select(avatarId: string) {
    setDraft(avatarId);
    setSaved(false);
    updateAvatar.reset();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setFileError(undefined);
    if (!file.type.startsWith("image/")) {
      setFileError(t("invalidImage"));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setFileError(t("fileTooLarge"));
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCustomDataUrl(dataUrl);
      select(dataUrl);
    } catch {
      setFileError(t("invalidImage"));
    }
  }

  function handleSave() {
    if (!draft) return;
    updateAvatar.mutate(
      { avatarId: draft },
      {
        onSuccess: () => {
          setDraft(undefined);
          setSaved(true);
        },
      },
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar name={user?.name ?? ""} src={resolveAvatarSrc(selected)} className="h-16 w-16 text-lg" />
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-primary">{t("profilePicture")}</h2>
          <p className="text-sm text-label">{t("profilePictureHint")}</p>
        </div>
      </div>

      <div
        className="mt-4 grid grid-cols-5 gap-2 sm:gap-3"
        role="radiogroup"
        aria-label={t("profilePicture")}
      >
        {PRESET_AVATARS.map((preset, index) => {
          const isSelected = selected === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${t("avatarOption")} ${index + 1}`}
              onClick={() => select(preset.id)}
              className={cn(optionClass, "hover:opacity-90", isSelected && selectedClass)}
            >
              <img src={preset.src} alt="" className="aspect-square w-full rounded-full bg-background-2" />
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        {customPreview ? (
          <button
            type="button"
            role="radio"
            aria-checked={selected === customPreview}
            aria-label={t("customPhoto")}
            onClick={() => select(customPreview)}
            className={cn(optionClass, "shrink-0", selected === customPreview && selectedClass)}
          >
            <img src={customPreview} alt="" className="h-12 w-12 rounded-full object-cover" />
          </button>
        ) : null}
        <div className="min-w-0">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {t("uploadPhoto")}
          </Button>
          <p className="mt-1 text-xs text-label">{t("uploadPhotoHint")}</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
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
      {saved ? (
        <p className="mt-3 rounded-xl bg-background-2 px-3 py-2 text-sm text-primary" role="status">
          {t("avatarUpdated")}
        </p>
      ) : null}

      <Button
        type="button"
        className="mt-4 w-full"
        onClick={handleSave}
        disabled={!isDirty || updateAvatar.isPending}
      >
        {updateAvatar.isPending ? t("loading") : t("save")}
      </Button>
    </div>
  );
}
