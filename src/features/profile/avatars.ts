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

/** A chosen photo may be big: it is shrunk to AVATAR_SIDE before upload (GIFs aren't: 2 MB). */
export const MAX_AVATAR_BYTES = 30 * 1024 * 1024;
export const MAX_GIF_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIDE = 512;

/**
 * An avatar is a preset id ("avatar3"), an uploaded photo's URL
 * ("/uploads/avatars/…"), or a data URL (an old browser-only avatar).
 * Returns an <img> src, or undefined when the user has no avatar (initials).
 */
export function resolveAvatarSrc(avatar: string | null | undefined): string | undefined {
  if (!avatar) return undefined;
  if (avatar.startsWith("/uploads/") || avatar.startsWith("data:image/")) return avatar;
  return PRESET_AVATARS.find((a) => a.id === avatar)?.src;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read-failed"));
    reader.readAsDataURL(file);
  });
}
