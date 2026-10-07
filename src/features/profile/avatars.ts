const presetModules = import.meta.glob<string>("../../assets/avatars/avatar*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface PresetAvatar {
  id: string;
  src: string;
}

/** avatar1 … avatar10, in numeric order. */
export const PRESET_AVATARS: PresetAvatar[] = Object.entries(presetModules)
  .map(([path, src]) => ({ id: path.match(/(avatar\d+)\.svg$/)![1]!, src }))
  .sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)));

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * An avatar id is either a preset id ("avatar3") or a custom image as a data URL.
 * Returns an <img> src, or undefined when the user has no avatar (initials fallback).
 */
export function resolveAvatarSrc(avatarId: string | null | undefined): string | undefined {
  if (!avatarId) return undefined;
  if (avatarId.startsWith("data:image/")) return avatarId;
  return PRESET_AVATARS.find((a) => a.id === avatarId)?.src;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
    reader.readAsDataURL(file);
  });
}
