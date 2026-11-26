"use client";

import { useRef, useState } from "react";
import { Button } from "@auto-world/design-system";

function Photograph({ url, alt }: { url: string; alt: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed" | "offline">("loading");
  const failed = status === "failed" || status === "offline";

  function unavailable() {
    setStatus(window.navigator.onLine ? "failed" : "offline");
  }

  return <>
    <div className="catalogue-photo-frame" ref={frame} tabIndex={-1} role="group" aria-label={alt}>
      {failed ? <div className="catalogue-photo-message">
        <p role="status">{status === "offline" ? "Vous êtes hors connexion." : "Cette photo est indisponible."}</p>
        <Button variant="secondary" onClick={() => {
          frame.current?.focus();
          setStatus("loading");
        }}>Réessayer</Button>
      </div> : <>
        {status === "loading" && <span role="status">Chargement de la photo…</span>}
        <img src={url} alt={alt} referrerPolicy="no-referrer" decoding="async"
          ref={image => {
            if (!image?.complete) return;
            if (image.naturalWidth > 0) setStatus("ready");
            else unavailable();
          }}
          onLoad={() => setStatus("ready")}
          onError={unavailable} />
      </>}
    </div>
    <a className="site-nav" href={url} rel="external noreferrer" referrerPolicy="no-referrer">Ouvrir cette photo sur Leboncoin</a>
  </>;
}

export function PhotoGallery({ photos, label }: { photos: readonly string[]; label: string }) {
  const [index, setIndex] = useState(0);
  const url = photos[index];
  if (!url) return null;
  return <div id="catalogue-gallery-view" className="catalogue-gallery">
    <figure>
      <figcaption aria-live="polite" aria-atomic="true">Photo {index + 1} sur {photos.length} · Leboncoin</figcaption>
      <Photograph key={url} url={url} alt={`${label}, photo ${index + 1}`} />
      {photos.length > 1 && <div role="group" aria-label="Navigation entre les photos" className="catalogue-photo-controls">
        <Button variant="secondary" aria-disabled={index === 0}
          onClick={() => setIndex(Math.max(0, index - 1))}>Précédente</Button>
        <Button variant="secondary" aria-disabled={index + 1 === photos.length}
          onClick={() => setIndex(Math.min(photos.length - 1, index + 1))}>Suivante</Button>
      </div>}
    </figure>
  </div>;
}
