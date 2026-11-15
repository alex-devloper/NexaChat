export type PhotoViewerDetail = {
  url: string;
  name?: string;
};

const EVENT = "nexa:view-photo";

/** Opens the full-screen zoomable profile photo viewer. */
export function openPhotoViewer(url: string, name?: string): void {
  if (!url) return;

  window.dispatchEvent(
    new CustomEvent<PhotoViewerDetail>(EVENT, {
      detail: { url, name: name || "" },
    })
  );
}

export function onPhotoViewerOpen(
  handler: (detail: PhotoViewerDetail) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PhotoViewerDetail>).detail;
    if (detail?.url) handler(detail);
  };

  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
