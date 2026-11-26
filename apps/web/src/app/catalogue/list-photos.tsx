"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@auto-world/design-system";

const PhotosVisible = createContext(false);

export function ListPhotos({ children, hasPhotos }: { children: ReactNode; hasPhotos: boolean }) {
  const [visible, setVisible] = useState(false);
  return <PhotosVisible.Provider value={visible}>
    {hasPhotos && <Button variant="secondary" aria-expanded={visible} aria-controls="catalogue-results"
      onClick={() => setVisible(!visible)}>
      {visible ? "Masquer les photos de Leboncoin" : "Afficher les photos de Leboncoin"}
    </Button>}
    {children}
  </PhotosVisible.Provider>;
}

export function ListingThumbnail({ src }: { src?: string }) {
  const visible = useContext(PhotosVisible);
  if (!visible) return null;
  return <span className="catalogue-thumbnail">
    {src ? <ThumbnailImage key={src} src={src} /> : "Sans photo"}
  </span>;
}

function ThumbnailImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>Photo indisponible</>;
  return <img src={src} alt="" width={144} height={108} loading="lazy" decoding="async"
    referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
