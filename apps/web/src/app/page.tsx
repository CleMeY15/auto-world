import { redirect } from "next/navigation";
import { privateCatalogEnabled } from "../catalogue/mode";
import { connection } from "next/server";

import { resolveDemoBackendMode } from "../demo/backend";
import { ProductWordmark } from "./product-wordmark";
import "./preview-home.css";
import { FoundationPreview } from "./preview";

export default async function HomePage() {
  await connection();
  if (privateCatalogEnabled()) redirect("/catalogue");
  const demoEnabled = resolveDemoBackendMode() !== "disabled";

  return (
    <>
      <a className="site-skip" href="#main" tabIndex={0}>Aller au contenu</a>
      <header className="site-header site-container">
        <ProductWordmark />
        <a className="site-nav" href="#states">Voir les états</a>
      </header>
      <main className="site-container" id="main" tabIndex={-1}>
        <div className="site-intro preview-intro">
          <h1>Aperçu de l’interface</h1>
          <div className="preview-entry">
            {demoEnabled ? (
              <a className="aw-button site-search-link" href="/demo">Essayer la recherche démo</a>
            ) : (
              <p>Des critères lisibles, des actions simples et des réponses claires.</p>
            )}
            <p className="site-disclosure">Aucune annonce ni recherche réelle.</p>
          </div>
        </div>
        <FoundationPreview />
      </main>
      <footer className="site-footer site-container">
        AutoFind
        <nav className="site-tools" aria-label="Outils">
          <a className="site-nav" href="/carte-grise">Carte grise</a>
          <a className="site-nav" href="/historique-vehicule">Historique du véhicule</a>
          <a className="site-nav" href="/importation">Dossier d’importation</a>
        </nav>
      </footer>
    </>
  );
}
