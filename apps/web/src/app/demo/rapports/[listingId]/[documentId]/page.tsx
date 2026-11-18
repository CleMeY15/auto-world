import { connection } from "next/server";
import { notFound } from "next/navigation";

import { resolveDemoBackendMode } from "../../../../../demo/backend";
import { providerLabels, reportsForListing } from "../../../../../demo/vehicle-reports";

export const metadata = { title: "Document d’exemple — Auto World" };

export default async function ExampleReportPage({ params }: {
  readonly params: Promise<{ listingId: string; documentId: string }>;
}) {
  await connection();
  if (resolveDemoBackendMode() !== "offline") notFound();
  const { listingId, documentId } = await params;
  const report = reportsForListing(listingId).find((item) => item.id === documentId);
  if (!report) notFound();

  return (
    <main className="site-container">
      <nav className="site-toolbar" aria-label="Publication">
        <a className="site-nav" href={`/demo#detail/${report.listingId}`}>Retour à l’annonce</a>
      </nav>
      <article className="site-intro">
        <p>{report.vehicle}</p>
        <h1>Exemple de rapport {providerLabels[report.provider]}</h1>
        <p>Simulation créée par Auto World. Toutes les données de ce document sont fictives.</p>
        <h2>Observation du véhicule</h2>
        <p>{report.observation}</p>
        <p>Provenance déclarée dans le scénario · {report.suppliedBy === "titulaire" ? "Titulaire de la carte grise" : "Vendeur"}</p>
      </article>
    </main>
  );
}
