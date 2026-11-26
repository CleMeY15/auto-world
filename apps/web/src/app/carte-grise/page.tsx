import type { Metadata } from "next";
import { ProductWordmark } from "../product-wordmark";
import "../guide.css";

export const metadata: Metadata = {
  title: "Estimer ma carte grise — AutoFindex",
  description: "Préparez les informations utiles puis estimez votre carte grise sur le simulateur officiel de Service Public.",
};

export default function RegistrationGuidePage() {
  return (
    <>
      <a className="site-skip" href="#main">Aller au contenu</a>
      <header className="site-header site-container guide-header">
        <ProductWordmark />
        <a className="site-nav" href="/">Accueil</a>
      </header>
      <main className="site-container guide" id="main" tabIndex={-1}>
        <div className="guide-layout">
          <section className="guide-intro" aria-labelledby="registration-title">
            <h1 id="registration-title">Estimer ma <span>carte grise</span></h1>
            <p>Pour un véhicule déjà immatriculé en France, utilisez le simulateur officiel de Service Public.</p>
            <p className="guide-muted">L’estimation se fait sur le site officiel. AutoFindex ne calcule pas de montant.</p>
            <a
              className="aw-button guide-primary"
              id="registration-simulator"
              href="https://www.service-public.gouv.fr/simulateur/calcul/cout-certificat-immatriculation"
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-describedby="registration-destination"
            >Continuer sur Service Public</a>
            <p className="guide-note" id="registration-destination">Site officiel · Nouvel onglet</p>
          </section>
          <section className="guide-aside" aria-labelledby="registration-prepare">
            <h2 id="registration-prepare">À préparer</h2>
            <p>Gardez la carte grise actuelle à portée de main.</p>
            <ul>
              <li>La date de première mise en circulation.</li>
              <li>La puissance fiscale, rubrique <strong>P.6</strong>.</li>
              <li>L’énergie du véhicule, rubrique <strong>P.3</strong>.</li>
              <li>Votre département de résidence.</li>
            </ul>
            <p className="guide-muted">Choisissez votre démarche dans le simulateur. D’autres informations peuvent être demandées selon votre situation, et certains cas ne sont pas couverts.</p>
          </section>
        </div>
        <section className="guide-support" aria-label="Achat en Allemagne">
          <h2>Vous achetez votre voiture en Allemagne ?</h2>
          <a className="guide-help" href="/importation">Préparer mon dossier d’importation</a>
        </section>
        <section className="guide-support" aria-label="Informations pratiques">
          <p>Aucune information sur votre véhicule n’est demandée ici. La saisie se fait directement sur Service Public, selon ses propres règles de confidentialité.</p>
          <details>
            <summary>Si le simulateur ne s’ouvre pas</summary>
            <p>Une connexion internet est nécessaire. Réessayez depuis le lien ci-dessus ou consultez la fiche officielle pour retrouver le simulateur et les contacts utiles.</p>
            <a
              className="guide-help"
              id="registration-help"
              href="https://www.service-public.gouv.fr/particuliers/vosdroits/F19211"
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-describedby="registration-help-destination"
            >Consulter la fiche officielle</a>
            <p className="guide-note" id="registration-help-destination">Service Public · Nouvel onglet</p>
            <p>Si le service reste indisponible, revenez plus tard. AutoFindex ne peut ni vérifier son état ni récupérer votre estimation.</p>
          </details>
        </section>
      </main>
      <footer className="site-footer site-container">AutoFindex</footer>
    </>
  );
}
