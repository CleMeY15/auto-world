import { connection } from "next/server";
import { notFound } from "next/navigation";

import { demoBackendOrigin, resolveDemoBackendMode } from "../../../../../demo/backend";
import { parseDemoHttpOutcomeV2, parsePublicListingId } from "../../../../../demo/protocol";
import { readDemoBackendText } from "../../../../../demo/proxy";
import { providerLabels, reportFixtureVersion, reportsForListing } from "../../../../../demo/vehicle-reports";

import { ProductWordmark } from "../../../../product-wordmark";
import { ReturnToListing } from "../../return-to-listing";

export const metadata = { title: "Document d’exemple · AutoFindex" };

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
    <>
      <a className="site-skip" href="#rapport">Aller au contenu</a>
      <header className="site-container site-header">
        <ProductWordmark />
        <ReturnToListing listingId={report.listingId} />
      </header>
      <main id="rapport" data-aw-default-theme="dark" tabIndex={-1} className="site-container report-reader">
        <article>
          <p className="report-vehicle">{report.vehicle}</p>
          <h1>Exemple de rapport {providerLabels[report.provider]}</h1>
          <p>Simulation créée par AutoFindex. Toutes les données de ce document sont fictives.</p>
          <h2>Observation du véhicule</h2>
          <p>{report.observation}</p>
          <p className="report-source">Provenance déclarée dans le scénario · {report.suppliedBy === "titulaire" ? "Titulaire de la carte grise" : "Vendeur"}</p>
        </article>
      </main>
    </>
  );
}
