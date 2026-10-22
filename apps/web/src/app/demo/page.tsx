import { connection } from "next/server";

import { DemoApp } from "./demo-app";
import "./demo.css";

export const metadata = {
  title: "Recherche synthétique — Auto World",
  description: "Démonstration locale de la recherche Auto World sur des données synthétiques.",
};

export default async function DemoPage() {
  await connection();
  const enabled = process.env.AUTO_WORLD_DEMO === "1";

  return (
    <>
      <a className="site-skip" href="#demo-main">Aller au contenu</a>
      <header className="demo-header demo-shell">
        <a className="site-wordmark" href="/" aria-label="Auto World, accueil">auto<span>world</span></a>
        <span className="demo-header-label">Démonstration locale</span>
      </header>
      <DemoApp enabled={enabled} />
      <footer className="demo-footer demo-shell">
        Auto World · Données synthétiques uniquement.
        <nav aria-label="Outils"><a className="site-nav" href="/carte-grise">Carte grise</a></nav>
      </footer>
    </>
  );
}
