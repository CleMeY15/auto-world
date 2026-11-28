"use client";

import { usePathname, useSearchParams } from "next/navigation";

export function CatalogueNav() {
  const path = usePathname();
  const criteria = new URLSearchParams(useSearchParams().toString());
  criteria.delete("depuis");
  const suffix = criteria.size ? "?" + criteria : "";
  return <nav className="catalogue-nav" aria-label="Catalogue">
    <a className="catalogue-nav-link" href={"/catalogue" + suffix}
      aria-current={path === "/catalogue" ? "page" : undefined}>Annonces</a>
    <a className="catalogue-nav-link" href={"/catalogue/favoris" + suffix}
      aria-current={path === "/catalogue/favoris" ? "page" : undefined}>Favoris</a>
  </nav>;
}
