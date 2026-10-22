import type { Metadata } from "next";
import "./registration.css";

export const metadata: Metadata = {
  title: "Estimer ma carte grise — Auto World",
  description: "Préparez les informations utiles puis estimez votre carte grise sur le simulateur officiel de Service Public.",
};

export default function RegistrationGuidePage() {
  return (
    <>
      <a className="site-skip" href="#main">Aller au contenu</a>
      <header className="site-header site-container registration-header">
        <a className="site-wordmark" href="/" aria-label="Auto World, accueil">auto<span>world</span></a>
        <a className="site-nav" href="/">Accueil</a>
      </header>
      <main className="site-container registration" id="main" tabIndex={-1}>
        <div className="registration-layout">
          <section className="registration-intro" aria-labelledby="registration-title">
            <h1 id="registration-title">Estimer ma carte grise</h1>
            <p>Pour un véhicule déjà immatriculé en France, utilisez le simulateur officiel de Service Public.</p>
            <p className="registration-muted">L’estimation se fait sur le site officiel. Auto World ne calcule pas de montant.</p>
            <a
              className="aw-button registration-primary"
              id="registration-simulator"
              href="https://www.service-public.gouv.fr/simulateur/calcul/cout-certificat-immatriculation"
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-describedby="registration-destination"
            >Continuer sur Service Public</a>
            <p className="registration-note" id="registration-destination">Site officiel · Nouvel onglet</p>
          </section>
          <section className="registration-preparation" aria-labelledby="registration-prepare">
            <h2 id="registration-prepare">À préparer</h2>
            <p>Gardez la carte grise actuelle à portée de main.</p>
            <ul>
              <li>La date de première mise en circulation.</li>
              <li>La puissance fiscale, rubrique <strong>P.6</strong>.</li>
              <li>L’énergie du véhicule, rubrique <strong>P.3</strong>.</li>
              <li>Votre département de résidence.</li>
            </ul>
            <p className="registration-muted">Choisissez votre démarche dans le simulateur. D’autres informations peuvent être demandées selon votre situation, et certains cas ne sont pas couverts.</p>
          </section>
        </div>
        <section className="registration-support" aria-label="Informations pratiques">
          <p>Aucune information sur votre véhicule n’est demandée ici. La saisie se fait directement sur Service Public, selon ses propres règles de confidentialité.</p>
          <details>
            <summary>Si le simulateur ne s’ouvre pas</summary>
            <p>Une connexion internet est nécessaire. Réessayez depuis le lien ci-dessus ou consultez la fiche officielle pour retrouver le simulateur et les contacts utiles.</p>
            <a
              className="registration-help"
              id="registration-help"
              href="https://www.service-public.gouv.fr/particuliers/vosdroits/F19211"
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-describedby="registration-help-destination"
            >Consulter la fiche officielle</a>
            <p className="registration-note" id="registration-help-destination">Service Public · Nouvel onglet</p>
            <p>Si le service reste indisponible, revenez plus tard. Auto World ne peut ni vérifier son état ni récupérer votre estimation.</p>
          </details>
        </section>
      </main>
      <footer className="site-footer site-container">Auto World · Choisir en confiance.</footer>
    </>
  );
}
