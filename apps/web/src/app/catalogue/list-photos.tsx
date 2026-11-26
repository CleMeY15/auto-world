"use client";

import { useState } from "react";

export function ListingThumbnail({ src }: { src?: string }) {
  return <span className="catalogue-thumbnail">
    {src ? <ThumbnailImage key={src} src={src} /> : "Sans photo"}
  </span>;
}

function ThumbnailImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>Photo indisponible</>;
  return <img src={src} alt="" width={144} height={108} loading="lazy" decoding="async"
    referrerPolicy="no-referrer" ref={image => {
      if (image?.complete && image.naturalWidth === 0) setFailed(true);
    }} onError={() => setFailed(true)} />;
}
