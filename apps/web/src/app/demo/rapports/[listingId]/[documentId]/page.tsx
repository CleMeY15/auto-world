import { connection } from "next/server";
import { notFound } from "next/navigation";

import { demoBackendOrigin, resolveDemoBackendMode } from "../../../../../demo/backend";
import { parseDemoHttpOutcomeV2, parsePublicListingId } from "../../../../../demo/protocol";
import { readDemoBackendText } from "../../../../../demo/proxy";
import { providerLabels, reportFixtureVersion, reportsForListing } from "../../../../../demo/vehicle-reports";

import { ReturnToListing } from "../../return-to-listing";

export const metadata = { title: "Document d’exemple — Auto World" };

export default async function ExampleReportPage({ params }: {
  readonly params: Promise<{ listingId: string; documentId: string }>;
}) {
  await connection();
  if (resolveDemoBackendMode() !== "offline") notFound();
  const { listingId, documentId } = await params;
  const report = reportsForListing(listingId).find((item) => item.id === documentId);
  const id = parsePublicListingId(listingId);
  if (!report || !id) notFound();

  const signal = AbortSignal.timeout(7_000);
  let fixtureVersion: string | undefined;
  try {
    const response = await fetch(`${demoBackendOrigin("offline")}/v2/demo/listings/${id}`, {
      cache: "no-store", redirect: "error", signal,
    });
    const source = await readDemoBackendText(response, signal);
    const outcome = parseDemoHttpOutcomeV2(source, response.status, new Date().toISOString(), id);
    if (outcome?.ok) fixtureVersion = outcome.data.fixtureVersion;
  } catch {
    // An unavailable listing cannot confirm that this document belongs to the active corpus.
  }
  if (fixtureVersion !== reportFixtureVersion) notFound();

  return (
    <main className="site-container">
      <nav className="site-toolbar" aria-label="Publication">
        <ReturnToListing listingId={report.listingId} />
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
