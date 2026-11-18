import Link from "next/link";
import { connection } from "next/server";

import { resolveDemoBackendMode } from "../demo/backend";
import { FoundationPreview } from "./preview";

export default async function HomePage() {
  await connection();
  const demoEnabled = resolveDemoBackendMode() !== "disabled";

  return (
    <>
      <a className="site-skip" href="#main" tabIndex={0}>Aller au contenu</a>
      <header className="site-header site-container">
        <Link className="site-wordmark" href="/" aria-label="Auto World, accueil">auto<span>world</span></Link>
        <a className="site-nav" href="#states">Voir les états</a>
      </header>
      <main className="site-container" id="main" tabIndex={-1}>
        <div className="site-intro">
          <h1>Aperçu de l’interface</h1>
          {demoEnabled ? (
            <a className="aw-button site-search-link" href="/demo">Essayer la recherche démo</a>
          ) : (
            <p>Des critères lisibles, des actions simples et des réponses claires.</p>
          )}
          <p className="site-disclosure">Aucune annonce ni recherche réelle.</p>
        </div>
        <FoundationPreview />
      </main>
      <footer className="site-footer site-container">
        Auto World · Choisir en confiance.
        <nav className="site-tools" aria-label="Outils">
          <a className="site-nav" href="/carte-grise">Carte grise</a>
          <a className="site-nav" href="/historique-vehicule">Historique du véhicule</a>
        </nav>
      </footer>
    </>
  );
}
