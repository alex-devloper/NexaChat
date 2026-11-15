import { useEffect, useState } from "react";

const MB = 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

function titleFor(file: File): string {
  if (file.type.startsWith("image/")) return "Photo";
  if (file.type.startsWith("video/")) return "Video";
  if (file.type.startsWith("audio/")) return "Voice message";
  return file.name;
}

function iconFor(file: File): string {
  if (file.type.startsWith("video/")) return "🎥";
  if (file.type.startsWith("audio/")) return "🎤";
  if (file.type === "application/pdf") return "📄";
  return "📎";
}

type Props = {
  file: File;
  /** "document" sends the untouched original file (high quality). */
  as?: "media" | "document";
  onRemove: () => void;
};

/** Clean attachment preview above the composer (no raw file names for media). */
export default function SelectedFileChip({ file, as, onRemove }: Props) {
  const [previewUrl, setPreviewUrl] = useState("");
  const isDocument = as === "document";
  const isImage = file.type.startsWith("image/");
  const showThumb = isImage && !isDocument;

  useEffect(() => {
    if (!showThumb) {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file, showThumb]);

  return (
    <div className="file-chip">
      <div className="file-chip-thumb">
        {showThumb && previewUrl ? (
          <img src={previewUrl} alt="" />
        ) : (
          <span>{isDocument ? "📄" : iconFor(file)}</span>
        )}
      </div>

      <div className="file-chip-info">
        <div className="file-chip-name">
          {isDocument ? file.name : titleFor(file)}
        </div>
        <div className="file-chip-meta">
          {formatSize(file.size)} ·{" "}
          {isDocument ? "Original quality" : "ready to send"}
        </div>
      </div>

      <button
        type="button"
        className="file-chip-x"
        onClick={onRemove}
        title="Remove attachment"
        aria-label="Remove attachment"
      >
        ✕
      </button>
    </div>
  );
}
