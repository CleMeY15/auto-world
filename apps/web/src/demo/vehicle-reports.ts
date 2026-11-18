export const reportFixtureVersion = "synthetic-description-v2";
const borealB2 = "lst_5696220ef97cf2af439e0279456ea36c70dd3df4e97b4455fc1577fa81aa8863";
const borealB1 = "lst_5b1bfbea35a7f70ba8a6358f2c1dca6e4a243af7e2e95df49d127fcaae748c09";

export const providerLabels = {
  histovec: "HistoVec",
  carvertical: "carVertical",
  carfax: "CARFAX",
} as const;

type Provider = keyof typeof providerLabels;

export interface SuppliedReportReference {
  readonly listingId: string;
  readonly provider: Provider;
  readonly suppliedBy: "titulaire" | "vendeur";
  readonly documentId: string;
}

interface ExampleDocument {
  readonly id: string;
  readonly listingId: string;
  readonly provider: Provider;
  readonly vehicle: string;
  readonly observation: string;
}

const documents: readonly ExampleDocument[] = [
  { id: "b2-parcours", listingId: borealB2, provider: "histovec", vehicle: "Modèle B2 fictif · 2022",
    observation: "Le scénario situe la première immatriculation de ce véhicule en 2022." },
  { id: "b2-kilometrage", listingId: borealB2, provider: "carvertical", vehicle: "Modèle B2 fictif · 2022",
    observation: "Dans ce scénario, le compteur indique 30 000 km lors d’une visite, puis 34 500 km à la publication." },
  { id: "b1-entretien", listingId: borealB1, provider: "carfax", vehicle: "Modèle B1 fictif · 2021",
    observation: "Le carnet fictif mentionne une visite d’entretien à 65 000 km. L’annonce indique ensuite 71 000 km." },
];

const suppliedReferences: readonly SuppliedReportReference[] = [
  { listingId: borealB2, provider: "histovec", suppliedBy: "titulaire", documentId: "b2-parcours" },
  { listingId: borealB2, provider: "carvertical", suppliedBy: "vendeur", documentId: "b2-kilometrage" },
  { listingId: borealB1, provider: "carfax", suppliedBy: "vendeur", documentId: "b1-entretien" },
];

// Only the registered document can supply a destination. Never interpret a reference as a URL.
export function resolveSuppliedReport(listingId: string, reference: SuppliedReportReference) {
  if (reference.listingId !== listingId || !["titulaire", "vendeur"].includes(reference.suppliedBy)) return undefined;
  const document = documents.find((item) => item.id === reference.documentId
    && item.listingId === listingId && item.provider === reference.provider);
  if (!document) return undefined;
  return {
    ...document,
    suppliedBy: reference.suppliedBy,
    href: `/demo/rapports/${document.listingId}/${document.id}`,
  };
}

export function reportsForListing(listingId: string) {
  return suppliedReferences.flatMap((reference) => resolveSuppliedReport(listingId, reference) ?? []);
}
