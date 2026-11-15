import { useEffect, useRef, useState } from "react";

import { onPhotoViewerOpen } from "../lib/photoViewer";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

type Photo = { url: string; name: string };

export default function PhotoViewer() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef({ w: 0, h: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

  const clamp = (value: number, limit: number) =>
    Math.min(limit, Math.max(-limit, value));

  const maxPan = (nextZoom: number) => {
    // Only pan along an axis when the zoomed photo is bigger than the screen area.
    const stage = stageRef.current;
    const viewW = stage ? stage.clientWidth : baseRef.current.w;
    const viewH = stage ? stage.clientHeight : baseRef.current.h;

    return {
      x: Math.max(0, (baseRef.current.w * nextZoom - viewW) / 2),
      y: Math.max(0, (baseRef.current.h * nextZoom - viewH) / 2),
    };
  };

  const close = () => {
    setPhoto(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    pointersRef.current.clear();
    dragRef.current = null;
    pinchRef.current = null;
  };

  useEffect(() =>
    onPhotoViewerOpen((detail) => {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setPhoto({ url: detail.url, name: detail.name || "" });
    }),
  []);

  useEffect(() => {
    if (!photo) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  const applyZoom = (next: number) => {
    const value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const limits = maxPan(value);

    setZoom(value);
    setOffset((prev) =>
      value === 1
        ? { x: 0, y: 0 }
        : { x: clamp(prev.x, limits.x), y: clamp(prev.y, limits.y) }
    );
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail for synthetic/ended pointers; dragging still works.
    }
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      pinchRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom,
      };
      dragRef.current = null;
      return;
    }

    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [a, b] = Array.from(pointersRef.current.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = distance / (pinchRef.current.distance || 1);
      applyZoom(pinchRef.current.zoom * ratio);
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;

    const limits = maxPan(zoom);

    setOffset({
      x: clamp(drag.originX + (event.clientX - drag.pointerX), limits.x),
      y: clamp(drag.originY + (event.clientY - drag.pointerY), limits.y),
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);

    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  if (!photo) return null;

  return (
    <div className="photo-viewer">
      <div className="photo-viewer-bar">
        <span>{photo.name}</span>
        <button onClick={close} title="Close">
          ✕
        </button>
      </div>

      <div
        ref={stageRef}
        className="photo-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => applyZoom(zoom > 1 ? 1 : DOUBLE_TAP_ZOOM)}
        onWheel={(event) => applyZoom(zoom - event.deltaY / 500)}
      >
        <img
          ref={imgRef}
          src={photo.url}
          alt={photo.name}
          className="photo-viewer-img"
          draggable={false}
          onLoad={(event) => {
            baseRef.current = {
              w: event.currentTarget.offsetWidth,
              h: event.currentTarget.offsetHeight,
            };
          }}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? "grab" : "zoom-in",
          }}
        />
      </div>

      <p className="photo-viewer-hint">
        Pinch, scroll or double-tap to zoom · drag to move
      </p>
    </div>
  );
}
