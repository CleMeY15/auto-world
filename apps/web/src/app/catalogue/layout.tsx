import { privateCatalogEnabled } from "../../catalogue/mode";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProductWordmark } from "../product-wordmark";
import "./catalogue.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Catalogue privé — AutoFindex", description: "Annonces automobiles observées par AutoFindex.",
  robots: { index: false, follow: false }, referrer: "no-referrer",
};
export default function CatalogLayout({ children }: { children: ReactNode }) {
  if (!privateCatalogEnabled()) notFound();
  return <>
    <a href="#catalogue" className="site-skip">Aller au contenu</a>
    <header className="site-container site-header catalogue-width" data-aw-default-theme="dark">
      <ProductWordmark />
      <nav aria-label="Catalogue"><a className="catalogue-nav-link" href="/catalogue">Annonces</a></nav>
    </header>
    <main id="catalogue" tabIndex={-1} className="site-container catalogue-width catalogue-main">{children}</main>
    <footer className="site-container catalogue-width">
      <nav className="site-tools" aria-label="Outils">
        <a className="site-nav" href="/carte-grise">Carte grise</a>
        <a className="site-nav" href="/historique-vehicule">Historique du véhicule</a>
        <a className="site-nav" href="/importation">Dossier d’importation</a>
      </nav>
    </footer>
  </>;
}
