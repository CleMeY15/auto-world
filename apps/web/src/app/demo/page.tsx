import { redirect } from "next/navigation";
import { privateCatalogEnabled } from "../../catalogue/mode";
import { connection } from "next/server";

import { demoBackendLabel, resolveDemoBackendMode } from "../../demo/backend";
import { ProductWordmark } from "../product-wordmark";
import { DemoApp } from "./demo-app";
import "./demo.css";

export const metadata = {
  title: "Recherche synthétique — AutoFind",
  description: "Démonstration locale de la recherche AutoFind sur des données synthétiques.",
};

export default async function DemoPage() {
  await connection();
  if (privateCatalogEnabled()) redirect("/catalogue");
  const backendMode = resolveDemoBackendMode();
  const enabled = backendMode !== "disabled";
  const storageNamespace = backendMode === "prototype" ? "prototype" : "offline";

  return (
    <>
      <a className="site-skip" href="#demo-main">Aller au contenu</a>
      <header className="demo-header demo-shell">
        <ProductWordmark />
        <span className="demo-header-label">{demoBackendLabel(backendMode)}</span>
      </header>
      <DemoApp enabled={enabled} storageNamespace={storageNamespace} />
      <footer className="demo-footer demo-shell">
        AutoFind · {backendMode === "prototype" ? "Prototype persistant local, données synthétiques uniquement." : "Données synthétiques uniquement."}
        <nav className="site-tools" aria-label="Outils">
          <a className="site-nav" href="/carte-grise">Carte grise</a>
          <a className="site-nav" href="/historique-vehicule">Historique du véhicule</a>
          <a className="site-nav" href="/importation">Dossier d’importation</a>
        </nav>
      </footer>
    </>
  );
}
