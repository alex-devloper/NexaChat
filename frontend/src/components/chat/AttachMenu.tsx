import { useEffect, useRef, useState } from "react";

export type AttachMode = "media" | "document";

type Props = {
  disabled?: boolean;
  onFile: (file: File, mode: AttachMode) => void;
  onContact: () => void;
  onLocation: () => void;
};

const MEDIA_ACCEPT = "image/*,video/*";

// Documents keep the original file — photos and videos included (WhatsApp style).
const DOC_ACCEPT =
  "image/*,video/*,.pdf,.doc,.docx,.txt,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

/** 📎 button with the four attachment choices used by WhatsApp. */
export default function AttachMenu({
  disabled,
  onFile,
  onContact,
  onLocation,
}: Props) {
  const [open, setOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleFile = (input: HTMLInputElement | null) => {
    setOpen(false);
    input?.click();
  };

  const onInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    mode: AttachMode
  ) => {
    const file = event.target.files?.[0];
    if (file) onFile(file, mode);
    event.target.value = "";
  };

  return (
    <div className="attach-menu" ref={rootRef}>
      <button
        type="button"
        className="attach-btn"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title="Attach"
        aria-label="Attach"
        aria-expanded={open}
      >
        📎
      </button>

      {open && (
        <div className="attach-pop" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => handleFile(mediaRef.current)}
          >
            <span className="attach-item-icon attach-icon-media">🖼️</span>
            <span className="attach-item-text">
              Photos &amp; videos
              <span className="attach-item-hint">Normal quality</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => handleFile(documentRef.current)}
          >
            <span className="attach-item-icon attach-icon-doc">📄</span>
            <span className="attach-item-text">
              Document
              <span className="attach-item-hint">Original quality</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onContact();
            }}
          >
            <span className="attach-item-icon attach-icon-contact">👤</span>
            <span className="attach-item-text">
              Contact
              <span className="attach-item-hint">Share directly</span>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLocation();
            }}
          >
            <span className="attach-item-icon attach-icon-location">📍</span>
            <span className="attach-item-text">
              Location
              <span className="attach-item-hint">Current position</span>
            </span>
          </button>
        </div>
      )}

      <input
        ref={mediaRef}
        type="file"
        accept={MEDIA_ACCEPT}
        style={{ display: "none" }}
        onChange={(event) => onInputChange(event, "media")}
      />

      <input
        ref={documentRef}
        type="file"
        accept={DOC_ACCEPT}
        style={{ display: "none" }}
        onChange={(event) => onInputChange(event, "document")}
      />
    </div>
  );
}
