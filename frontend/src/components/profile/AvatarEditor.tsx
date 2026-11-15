import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (file: File) => void | Promise<void>;
};

/** On-screen crop area in CSS pixels (kept in sync with index.css). */
const VIEW = 280;
/** Stored avatar size. */
const OUTPUT = 512;

export default function AvatarEditor({ src, busy, onCancel, onSave }: Props) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [preparing, setPreparing] = useState(false);

  // Scale that makes the shorter side fill the circle.
  const baseScale = natural ? VIEW / Math.min(natural.w, natural.h) : 1;
  const scale = baseScale * zoom;
  const dispW = natural ? natural.w * scale : 0;
  const dispH = natural ? natural.h * scale : 0;

  const maxX = Math.max(0, (dispW - VIEW) / 2);
  const maxY = Math.max(0, (dispH - VIEW) / 2);

  const clamp = (value: number, limit: number) =>
    Math.min(limit, Math.max(-limit, value));

  // Keep the photo covering the circle when zooming.
  useEffect(() => {
    setOffset((prev) => ({
      x: clamp(prev.x, maxX),
      y: clamp(prev.y, maxY),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxX, maxY]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture failures (synthetic pointers); dragging still works.
    }
    dragRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    setOffset({
      x: clamp(drag.originX + (e.clientX - drag.pointerX), maxX),
      y: clamp(drag.originY + (e.clientY - drag.pointerY), maxY),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const handleSave = async () => {
    const img = imgRef.current;
    if (!img || !natural) return;

    setPreparing(true);

    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Map the visible circle back to image pixels.
      const sourceSize = VIEW / scale;
      const sourceX = (dispW / 2 - VIEW / 2 - offset.x) / scale;
      const sourceY = (dispH / 2 - VIEW / 2 - offset.y) / scale;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        img,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        OUTPUT,
        OUTPUT
      );

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92)
      );

      if (!blob) return;

      await onSave(
        new File([blob], "profile-photo.jpg", { type: "image/jpeg" })
      );
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="dp-editor-backdrop">
      <div className="dp-editor">
        <div className="dp-editor-head">
          <button type="button" onClick={onCancel} disabled={busy || preparing}>
            Cancel
          </button>
          <strong style={{ fontSize: 15 }}>Crop photo</strong>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || preparing || !natural}
          >
            {busy || preparing ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="dp-editor-stage">
          <div
            className="dp-editor-viewport"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) =>
                setNatural({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: dispW || "auto",
                height: dispH || "auto",
                maxWidth: "none",
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                userSelect: "none",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>

        <div className="dp-editor-zoom">
          <span>−</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
          />
          <span>+</span>
        </div>

        <p className="dp-editor-hint">
          Drag to move · pinch or use the slider to zoom
        </p>
      </div>
    </div>
  );
}
