import type { Metadata } from "next";
import { ProductWordmark } from "../product-wordmark";
import { ImportChecklist } from "./checklist";
import "../guide.css";
import "./importation.css";

export const metadata: Metadata = {
  title: "Mon dossier d’importation Allemagne → France — AutoFindex",
  description: "Préparez les pièces d’une voiture d’occasion achetée en Allemagne et retrouvez les démarches officielles pour l’immatriculer en France.",
  referrer: "no-referrer",
};

const resources = [
  {
    title: "Vérifier les pièces à fournir",
    detail: "Choisissez le cas d’un véhicule immatriculé dans l’Union européenne. Vérifiez aussi les formulaires de demande et de cession à joindre.",
    url: "https://www.service-public.gouv.fr/particuliers/vosdroits/F1050",
  },
  {
    title: "Trouver ma démarche de quitus",
    detail: "Service Public indique le service compétent et les modalités selon votre domicile.",
    url: "https://www.service-public.gouv.fr/particuliers/vosdroits/F179",
  },
  {
    title: "Demander l’immatriculation en France",
    detail: "Accédez au téléservice France Titres depuis la fiche officielle.",
    url: "https://www.service-public.gouv.fr/particuliers/vosdroits/R49258",
  },
];

export default function ImportDossierPage() {
  return (
    <>
      <a className="site-skip" href="#main">Aller au contenu</a>
      <header className="site-header site-container guide-header">
        <ProductWordmark />
        <a className="site-nav" href="/demo">Recherche</a>
      </header>
      <main className="site-container guide import-page" id="main" tabIndex={-1}>
        <header className="import-intro">
          <p className="import-route">Allemagne <span aria-hidden="true">→</span><span className="import-sr"> vers </span> France</p>
          <h1>Préparer mon dossier <span>d’importation</span></h1>
          <p>Vous êtes un particulier et vous achetez une voiture d’occasion déjà immatriculée en Allemagne. Retrouvez les pièces à demander au vendeur et les démarches pour l’immatriculer en France métropolitaine.</p>
          <a className="site-nav" href="#demarches">Accéder aux démarches officielles</a>
        </header>
        <div className="import-layout">
          <ImportChecklist />
          <aside className="import-resources" aria-labelledby="demarches">
            <h2 id="demarches" tabIndex={-1}>Démarches officielles</h2>
            <p id="destinations">Service Public · Liens ouverts dans un nouvel onglet.</p>
            <ul>
              {resources.map(resource => (
                <li key={resource.url}>
                  <a className="guide-help" href={resource.url} target="_blank" rel="noopener noreferrer"
                    referrerPolicy="no-referrer" aria-describedby="destinations">{resource.title}</a>
                  <p>{resource.detail}</p>
                </li>
              ))}
            </ul>
            <p>Vous déposez les justificatifs auprès de l’administration. Les cases cochées ici servent uniquement à votre préparation personnelle.</p>
            <p className="import-source-date">Sources vérifiées le <time dateTime="2026-11-19">19 novembre 2026</time>.</p>
          </aside>
        </div>
      </main>
      <footer className="site-footer site-container">AutoFindex</footer>
    </>
  );
}
