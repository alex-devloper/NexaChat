import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export type SaveFileInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
};

/**
 * Dynamic import so the Cloudinary / AWS SDK packages stay optional:
 * the local driver works with zero extra dependencies, and switching
 * STORAGE_DRIVER only requires installing the matching SDK + setting keys.
 */
const dynamicImport = new Function(
  "specifier",
  "return import(specifier)"
) as (specifier: string) => Promise<any>;

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/**
 * Extensions come from the whitelisted MIME type only, never from the
 * uploaded file name: that stops .html/.svg being stored and then served
 * as a page from the API origin.
 */
const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "text/plain": ".txt",
};

function safeExtension(mimeType: string): string {
  return MIME_EXTENSION[mimeType] || ".bin";
}

function buildFileName(mimeType: string): string {
  return `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExtension(
    mimeType
  )}`;
}

async function saveLocal(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, fileName), buffer);

  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    // Caller falls back to the request origin when no PUBLIC_BASE_URL is set.
    return `/uploads/${fileName}`;
  }

  return `${base}/uploads/${fileName}`;
}

async function saveCloudinary(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      "Cloudinary keys missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
    );
  }

  let cloudinary: any;
  try {
    const mod = await dynamicImport("cloudinary");
    cloudinary = mod.v2 || mod.default?.v2 || mod.default;
  } catch {
    throw new Error(
      "Cloudinary SDK not installed. Run `npm install cloudinary` in backend/ to use STORAGE_DRIVER=cloudinary."
    );
  }

  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });

  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "nexachat",
    public_id: path.parse(fileName).name,
    resource_type: "auto",
  });

  return result.secure_url as string;
}

async function saveS3(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const {
    AWS_REGION,
    AWS_S3_BUCKET,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_S3_PUBLIC_BASE_URL,
  } = process.env;

  if (
    !AWS_REGION ||
    !AWS_S3_BUCKET ||
    !AWS_ACCESS_KEY_ID ||
    !AWS_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      "S3 config missing. Set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY."
    );
  }

  let S3Client: any;
  let PutObjectCommand: any;

  try {
    const mod = await dynamicImport("@aws-sdk/client-s3");
    S3Client = mod.S3Client;
    PutObjectCommand = mod.PutObjectCommand;
  } catch {
    throw new Error(
      "AWS S3 SDK not installed. Run `npm install @aws-sdk/client-s3` in backend/ to use STORAGE_DRIVER=s3."
    );
  }

  const client = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  });

  const key = `nexachat/${fileName}`;

  await client.send(
    new PutObjectCommand({
      Bucket: AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  const base = (
    AWS_S3_PUBLIC_BASE_URL ||
    `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com`
  ).replace(/\/+$/, "");

  return `${base}/${key}`;
}

/**
 * Saves an uploaded file and returns a public URL.
 * Driver is chosen by STORAGE_DRIVER (local | cloudinary | s3).
 */
export async function saveFile({
  buffer,
  originalName,
  mimeType,
}: SaveFileInput): Promise<{ url: string; fileName: string }> {
  const driver = (process.env.STORAGE_DRIVER || "local").toLowerCase();
  void originalName;
  const fileName = buildFileName(mimeType);

  if (driver === "cloudinary") {
    return { url: await saveCloudinary(buffer, fileName, mimeType), fileName };
  }

  if (driver === "s3") {
    return { url: await saveS3(buffer, fileName, mimeType), fileName };
  }

  return { url: await saveLocal(buffer, fileName), fileName };
}

export { UPLOAD_DIR };
