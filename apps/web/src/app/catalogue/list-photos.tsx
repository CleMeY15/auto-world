"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronLeftIcon } from "@auto-world/design-system";

export function ListingCard({ href, label, photos, children }: {
  href: string;
  label: string;
  photos: readonly string[];
  children: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const current = Math.min(index, Math.max(0, photos.length - 1));
  const src = photos[current];
  const multiple = photos.length > 1;

  function move(step: number) {
    setIndex(i => Math.max(0, Math.min(photos.length - 1, Math.min(i, photos.length - 1) + step)));
  }

  return <>
    <a className="catalogue-row" href={href}>
      <span className={multiple ? "catalogue-card-media catalogue-card-swipe" : "catalogue-card-media"}
        onPointerDown={event => {
          swiped.current = false;
          touchStart.current = multiple && event.pointerType === "touch" && event.isPrimary
            ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
        }}
        onPointerCancel={() => { touchStart.current = null; }}
        onPointerUp={event => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
          swiped.current = true;
          move(dx < 0 ? 1 : -1);
        }}
        onClick={event => {
          if (swiped.current) event.preventDefault();
          swiped.current = false;
        }}>
        <span className="catalogue-thumbnail">
          {src ? <ThumbnailImage key={src} src={src} /> : "Sans photo"}
        </span>
      </span>
      {children}
    </a>
    {multiple && <div role="group" aria-label={`Photos de ${label}`} className="catalogue-card-controls"
      onKeyDown={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        move(event.key === "ArrowRight" ? 1 : -1);
      }}>
      <button type="button" aria-label="Photo précédente" aria-disabled={current === 0}
        onClick={() => move(-1)}><ChevronLeftIcon /></button>
      <button type="button" aria-label="Photo suivante" aria-disabled={current === photos.length - 1}
        onClick={() => move(1)}><ChevronLeftIcon className="catalogue-chevron-next" /></button>
      <span className="catalogue-photo-count" role="status" aria-atomic="true">
        <span aria-hidden="true">{current + 1} / {photos.length}</span>
        <span className="catalogue-sr-only">Photo {current + 1} sur {photos.length}</span>
      </span>
    </div>}
  </>;
}

function ThumbnailImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>Photo indisponible</>;
  return <img src={src} alt="" width={144} height={108} loading="lazy" decoding="async"
    draggable={false} referrerPolicy="no-referrer" ref={image => {
      if (image?.complete && image.naturalWidth === 0) setFailed(true);
    }} onError={() => setFailed(true)} />;
}
