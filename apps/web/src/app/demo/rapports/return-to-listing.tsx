"use client";

export function ReturnToListing({ listingId }: { readonly listingId: string }) {
  return (
    <a className="site-nav" href={`/demo#detail/${listingId}`} onClick={(event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (window.location.hash === "#depuis-annonce" && window.history.length === 1) window.close();
    }}>
      Retour à l’annonce
    </a>
  );
}
