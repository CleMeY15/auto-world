import { providerLabels, reportsForListing } from "../../demo/vehicle-reports";

export function VehicleReports({ listingId, hasExampleCorpus }: { readonly listingId: string; readonly hasExampleCorpus: boolean }) {
  const reports = hasExampleCorpus ? reportsForListing(listingId) : [];
  return (
    <section className="demo-vehicle-reports" aria-labelledby="demo-reports-title">
      <h2 id="demo-reports-title">Rapports du véhicule</h2>
      {reports.length > 0 ? (
        <>
          <p>Documents d’exemple joints à cette annonce fictive.</p>
          <ul className="demo-evidence-list">
            {reports.map((report) => (
              <li key={report.id}>
                <a className="site-nav" href={report.href} referrerPolicy="no-referrer">
                  Consulter l’exemple {providerLabels[report.provider]}
                </a>
                <span>Provenance déclarée · {report.suppliedBy === "titulaire" ? "Titulaire de la carte grise" : "Vendeur"}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>Aucun rapport fourni avec cette annonce.</p>
          <a className="site-nav" href="/historique-vehicule">Demander un rapport HistoVec au vendeur</a>
        </>
      )}
    </section>
  );
}
