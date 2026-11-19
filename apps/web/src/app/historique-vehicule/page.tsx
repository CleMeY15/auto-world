import type { Metadata } from "next";
import { ProductWordmark } from "../product-wordmark";
import "../guide.css";

export const metadata: Metadata = {
  title: "Demander un rapport HistoVec — AutoFind",
  description: "Découvrez comment demander au vendeur le rapport HistoVec d’un véhicule et consulter le service officiel.",
};

export default function HistoryGuidePage() {
  return (
    <>
      <a className="site-skip" href="#main">Aller au contenu</a>
      <header className="site-header site-container guide-header">
        <ProductWordmark />
        <a className="site-nav" href="/">Accueil</a>
      </header>
      <main className="site-container guide" id="main" tabIndex={-1}>
        <div className="guide-layout">
          <section className="guide-intro" aria-labelledby="history-title">
            <h1 id="history-title">Demander un rapport <span>HistoVec</span></h1>
            <p>Avant d’acheter un véhicule d’occasion, demandez son historique administratif au vendeur.</p>
            <p className="guide-muted">Le titulaire actuel de la carte grise — généralement le vendeur — génère le rapport sur HistoVec, le service officiel.</p>
            <a
              className="aw-button guide-primary"
              id="history-official"
              href="https://histovec.interieur.gouv.fr/histovec/accueil"
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-describedby="history-destination"
            >Ouvrir le site officiel HistoVec</a>
            <p className="guide-note" id="history-destination">Site officiel · Nouvel onglet</p>
            <p className="guide-handoff">Ce lien ouvre le site HistoVec, pas le rapport d’un véhicule. Pour le consulter, utilisez le lien partagé par son titulaire.</p>
          </section>
          <section className="guide-aside history-guide-steps" aria-labelledby="history-steps-title">
            <h2 id="history-steps-title">Comment obtenir le rapport</h2>
            <ol>
              <li>
                <strong>Demandez-le au vendeur.</strong>
                <p>Le titulaire de la carte grise peut générer le rapport et vous en partager le lien.</p>
                <details>
                  <summary>Exemple de message au vendeur</summary>
                  <p>Bonjour, pourriez-vous m’envoyer le lien du rapport HistoVec de votre véhicule ? Merci !</p>
                </details>
              </li>
              <li><strong>Consultez le lien reçu.</strong><p>Ouvrez le lien du rapport transmis par le titulaire directement sur HistoVec.</p></li>
              <li><strong>Le lien ne fonctionne plus ?</strong><p>Demandez au vendeur ou au titulaire de vous le partager à nouveau.</p></li>
            </ol>
          </section>
        </div>
        <section className="guide-support history-guide-support" aria-label="Informations pratiques">
          <p>AutoFind ne récupère ni ne vérifie le rapport. L’historique administratif ne garantit pas l’état du véhicule et ne remplace pas les documents et vérifications nécessaires à la vente.</p>
          <details>
            <summary>Besoin d’aide pour consulter HistoVec ?</summary>
            <p>Seul le titulaire actuel d’une carte grise valide peut générer le rapport. Si vous achetez le véhicule, demandez son lien au vendeur ou au titulaire : aucune plaque ni information personnelle n’est à saisir ici.</p>
            <p>Une connexion internet est nécessaire pour ouvrir HistoVec. Si le service ne s’ouvre pas, réessayez plus tard. AutoFind ne peut pas vérifier sa disponibilité.</p>
            <a
              className="guide-help"
              id="history-help"
              href="https://www.service-public.gouv.fr/particuliers/vosdroits/F1707"
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-describedby="history-help-destination"
            >Consulter les démarches de vente</a>
            <p className="guide-note" id="history-help-destination">Service Public · Nouvel onglet</p>
          </details>
        </section>
      </main>
      <footer className="site-footer site-container">AutoFind</footer>
    </>
  );
}
