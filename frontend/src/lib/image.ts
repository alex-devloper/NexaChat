const MAX_SIDE = 1600;
const QUALITY = 0.82;

/** Normal chat quality, like WhatsApp's default photo compression. */
const MEDIA_MAX_SIDE = 1600;
const MEDIA_QUALITY = 0.8;
const KEEP_ORIGINAL_UNDER = 300 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image"));
    };

    image.src = url;
  });
}

/**
 * Photos straight from a phone camera are far too big for local storage.
 * Scale them down and return a compact JPEG data URL.
 */
/**
 * Photos are compressed to "normal quality" before upload. Videos and
 * documents keep the original file (high quality).
 */
export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // Keep animated GIFs untouched.
  if (file.type === "image/gif") return file;

  const image = await loadImage(file);
  const scale = Math.min(
    1,
    MEDIA_MAX_SIDE / Math.max(image.width, image.height)
  );

  if (scale === 1 && file.size <= KEEP_ORIGINAL_UNDER) return file;

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", MEDIA_QUALITY)
  );

  if (!blob || blob.size >= file.size) return file;

  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}

export async function fileToWallpaper(file: File): Promise<string> {
  const image = await loadImage(file);

  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", QUALITY);
}
