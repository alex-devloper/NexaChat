import { Router, Request } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
import { uploadLimiter } from "../middleware/rateLimit";
import { saveFile } from "../storage";

const router = Router();

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/**
 * Whitelist: only these MIME types are accepted. Anything else is rejected
 * before it ever reaches storage.
 */
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function normalizedMime(file: Express.Multer.File): string {
  return (file.mimetype || "").split(";")[0].trim().toLowerCase();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb) => {
    const mime = normalizedMime(file);

    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return cb(
        new Error(
          `File type not allowed: ${mime || "unknown"}. Allowed: images, video, audio, PDF.`
        )
      );
    }

    return cb(null, true);
  },
});

function absoluteUrl(req: Request, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;

  const base =
    (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") ||
    `${req.protocol}://${req.get("host")}`;

  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** POST /api/upload — private; requires Bearer token. */
router.post(
  "/",
  requireAuth,
  uploadLimiter,
  (req, res) => {
    upload.single("file")(req, res, async (err: unknown) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
            ? "File is too large (max 25 MB)"
            : (err as Error).message || "Upload failed";

        return res.status(400).json({ message });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No file provided" });
      }

      try {
        const { url, fileName } = await saveFile({
          buffer: file.buffer,
          originalName: file.originalname || "upload",
          mimeType: normalizedMime(file),
        });

        return res.status(201).json({
          file: {
            url: absoluteUrl(req, url),
            name: fileName,
            type: normalizedMime(file),
            size: file.size,
          },
        });
      } catch (uploadErr) {
        console.error("upload error:", uploadErr);
        return res.status(500).json({
          message: (uploadErr as Error).message || "Could not store file",
        });
      }
    });
  }
);

export default router;
