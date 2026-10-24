// Shrinks photos in the browser before they are uploaded: a phone photo of
// 4–8 MB becomes a few hundred KB that still looks sharp on screen, uploads
// fast on mobile data and keeps the server's disk small. Re-encoding also
// drops the photo's metadata (camera details, GPS location).

/** The longest side of an uploaded photo, in pixels. */
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.82;

/**
 * A smaller JPEG version of an image file. GIFs stay as they are (shrinking
 * would stop the animation), and so does anything the browser can't read or
 * that would not get smaller.
 */
export async function shrinkImage(file: File, maxSide = MAX_SIDE): Promise<File> {
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    // "from-image" turns phone photos the right way up (EXIF orientation).
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // JPEG has no transparency: transparent parts of a PNG become white, not black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
}
