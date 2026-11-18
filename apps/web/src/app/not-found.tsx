import { ProductWordmark } from "./product-wordmark";

export default function NotFound() {
  return (
    <>
      <header className="site-header site-container"><ProductWordmark /></header>
      <main className="site-container site-intro" data-aw-default-theme="dark">
        <h1>Page introuvable</h1>
        <p>Ce lien ne mène à aucune page disponible.</p>
        <a className="aw-button site-search-link" href="/demo">Revenir à la recherche</a>
      </main>
    </>
  );
}
