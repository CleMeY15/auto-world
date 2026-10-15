import type { ReactNode } from "react";
import { Banner, BookmarkIcon, Button, Card, ChevronLeftIcon, Skeleton } from "@auto-world/design-system/primitives";
import type { DemoCatalogResponseV2, DemoEvidence, DemoResultV2, DemoSearchQueryV2 } from "@auto-world/demo-search-contract";
import { resolveDescription } from "../../demo/catalog";

export function SyntheticDisclosure() {
  return <p className="demo-disclosure">Données entièrement synthétiques. Aucun véhicule à vendre.</p>;
}

export function NeutralIllustration() {
  return (
    <svg aria-label="Illustration de démonstration" className="demo-illustration" role="img" viewBox="0 0 320 160">
      <rect x="1" y="1" width="318" height="158" rx="8" />
      <path d="M56 104h208M78 103l18-36h119l28 36M109 67l15-21h57l24 21" />
      <circle cx="105" cy="108" r="18" /><circle cx="220" cy="108" r="18" />
      <path d="M37 126h246" />
    </svg>
  );
}

function formatPrice(result: DemoResultV2) {
  if (result.price.status === "unavailable") return "Prix non disponible";
  const formatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: result.price.value.currency,
    maximumFractionDigits: new Intl.NumberFormat("fr-FR", { style: "currency", currency: result.price.value.currency }).resolvedOptions().maximumFractionDigits,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(result.price.value.amountMinor / (10 ** digits));
}

function formatMileage(result: DemoResultV2) {
  if (result.mileage.status === "unavailable") return "Kilométrage non disponible";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(result.mileage.value.amount)} ${result.mileage.value.unit}`;
}

function formatEvidenceValue(evidence: DemoEvidence) {
  if (evidence.field === "mileage") return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(evidence.value.amount)} ${evidence.value.unit}`;
  const formatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: evidence.value.currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(evidence.value.amountMinor / (10 ** digits));
}

function availabilityLabel(value: DemoResultV2["availability"]) {
  if (value === "active") return "Publication active";
  if (value === "withdrawn") return "Publication retirée";
  if (value === "deleted") return "Publication supprimée";
  return "Publication introuvable";
}

export function DescriptionSummary({ result, catalog }: { readonly result: DemoResultV2; readonly catalog?: DemoCatalogResponseV2 }) {
  if (result.description.status === "unavailable") return <p className="demo-description-unavailable">Description synthétique non disponible.</p>;
  const resolved = resolveDescription(catalog, result.description.value);
  if (resolved === undefined) return <p className="demo-description-unavailable">Libellés synthétiques indisponibles. Les identifiants bruts ne sont jamais affichés.</p>;
  return (
    <div className="demo-description">
      <h2>{resolved.makeLabel} · {resolved.modelLabel}</h2>
      <p>Première immatriculation fictive : {resolved.firstRegistrationYear}</p>
      <p className="demo-provenance">Déclaration issue d’une fixture synthétique, non vérifiée comme fait automobile.</p>
    </div>
  );
}

export function ResultSummary({ result, catalog }: { readonly result: DemoResultV2; readonly catalog?: DemoCatalogResponseV2 }) {
  return (
    <>
      <DescriptionSummary result={result} catalog={catalog} />
      <dl className="demo-facts">
        <div><dt>Prix observé</dt><dd>{formatPrice(result)}</dd></div>
        <div><dt>Kilométrage observé</dt><dd>{formatMileage(result)}</dd></div>
      </dl>
    </>
  );
}

export function ActiveCriteria({ query, catalog }: { readonly query?: DemoSearchQueryV2; readonly catalog?: DemoCatalogResponseV2 }) {
  if (query === undefined) return null;
  const criteria: string[] = [];
  const make = catalog?.taxonomyRelease.makes.find((item) => item.makeId === query.makeId);
  const model = catalog?.taxonomyRelease.models.find((item) => item.makeId === query.makeId && item.modelId === query.modelId);
  if (query.makeId !== undefined) criteria.push(make?.primaryName.value ?? "Marque : libellé indisponible");
  if (query.modelId !== undefined) criteria.push(model?.primaryName.value ?? "Modèle : libellé indisponible");
  if (query.firstRegistrationYear !== undefined) criteria.push(`Première immatriculation fictive : ${query.firstRegistrationYear}`);
  if (query.priceMaxMinor !== undefined) criteria.push(`Budget ≤ ${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(query.priceMaxMinor / 100)}`);
  if (query.mileageMaxKm !== undefined) criteria.push(`Kilométrage ≤ ${new Intl.NumberFormat("fr-FR").format(query.mileageMaxKm)} km`);
  return <p className="demo-field-hint">Critères appliqués : {criteria.length === 0 ? "aucun filtre" : criteria.join(" · ")}.</p>;
}

export function ResultCard({ index, result, catalog, saved, onOpen, onToggleSaved }: {
  readonly index: number;
  readonly result: DemoResultV2;
  readonly saved: boolean;
  readonly onOpen: () => void;
  readonly onToggleSaved: () => void;
  readonly catalog?: DemoCatalogResponseV2;
}) {
  return (
    <Card className="demo-result-card">
      <div className="demo-result-copy">
        <p className="demo-status">{availabilityLabel(result.availability)}</p>
        <p className="demo-result-number">Publication synthétique {String(index + 1).padStart(2, "0")}</p>
        <ResultSummary result={result} catalog={catalog} />
      </div>
      <div className="demo-card-actions">
        <Button variant="secondary" onClick={onToggleSaved} aria-pressed={saved}>
          <BookmarkIcon />{saved ? "Retirer des favoris" : "Ajouter aux favoris"}
        </Button>
        <Button id={`demo-result-open-${index}`} onClick={onOpen}>Voir le détail</Button>
      </div>
    </Card>
  );
}

export function EvidenceDetails({ result, catalog }: { readonly result: DemoResultV2; readonly catalog?: DemoCatalogResponseV2 }) {
  const priceValues = new Set(result.evidence.filter((item) => item.field === "price").map(formatEvidenceValue));
  const mileageValues = new Set(result.evidence.filter((item) => item.field === "mileage").map(formatEvidenceValue));
  const contradictory = priceValues.size > 1 || mileageValues.size > 1;
  return (
    <section aria-labelledby="evidence-title" className="demo-evidence">
      <div className="demo-section-heading">
        <div><h2 id="evidence-title">Observations disponibles</h2><p>Chaque valeur reste liée à sa date et à son niveau de confiance.</p></div>
      </div>
      {contradictory ? <Banner role="note" tone="warning">Plusieurs observations se contredisent. La valeur la plus récente est affichée en premier.</Banner> : null}
      {result.evidence.length === 0 ? <p>Aucune observation détaillée n’est disponible.</p> : (
        <ol className="demo-evidence-list">
          {[...result.evidence].reverse().map((item, index) => (
            <li key={item.evidenceId}>
              <strong>{item.field === "price" ? "Prix" : "Kilométrage"} · observation {index + 1}</strong>
              <span>{formatEvidenceValue(item)}</span>
              <span>Observé le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.observedAt))}</span>
              <span>Confiance de l’observation : {new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(item.confidenceBps / 10_000)}</span>
            </li>
          ))}
        </ol>
      )}
      <DescriptionEvidenceDetails result={result} catalog={catalog} />
    </section>
  );
}

function DescriptionEvidenceDetails({ result, catalog }: { readonly result: DemoResultV2; readonly catalog?: DemoCatalogResponseV2 }) {
  if (result.descriptionEvidence.length === 0) return <div className="demo-description-history"><h2>Déclarations synthétiques</h2><p>Aucune déclaration de description n’est disponible.</p></div>;
  const resolved = result.descriptionEvidence.map((item) => ({ item, value: resolveDescription(catalog, item.value) }));
  const comparable = result.descriptionEvidence.map(({ value }) => JSON.stringify([value.makeId, value.modelId, value.firstRegistrationYear]));
  const contradictory = new Set(comparable).size > 1;
  return (
    <section aria-labelledby="description-evidence-title" className="demo-description-history">
      <div className="demo-section-heading"><div><h2 id="description-evidence-title">Déclarations synthétiques</h2><p>Historique séparé des observations de prix et de kilométrage.</p></div></div>
      {contradictory ? <Banner role="note" tone="warning">Les déclarations synthétiques se contredisent. Elles restent affichées séparément.</Banner> : null}
      {resolved.some((entry) => entry.value === undefined) ? <p>Certains libellés ne peuvent pas être reliés au catalogue validé.</p> : null}
      <ol className="demo-evidence-list">
        {[...resolved].reverse().map(({ item, value }, index) => (
          <li key={item.evidenceId}>
            <strong>Déclaration synthétique {index + 1}</strong>
            <span>{value ? `${value.makeLabel} · ${value.modelLabel}` : "Libellés indisponibles"}</span>
            {value ? <span>Première immatriculation fictive : {value.firstRegistrationYear}</span> : null}
            <span>Déclaré le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.capturedAt))}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ScreenHeader({ title, description, backLabel, onBack, action }: {
  readonly title: string;
  readonly description?: string;
  readonly backLabel?: string;
  readonly onBack?: () => void;
  readonly action?: ReactNode;
}) {
  return (
    <div className="demo-screen-heading">
      {onBack && backLabel ? <Button className="demo-back" variant="secondary" onClick={onBack}><ChevronLeftIcon />{backLabel}</Button> : null}
      <div className="demo-heading-row">
        <div><h1 id="demo-screen-title" tabIndex={-1}>{title}</h1>{description ? <p>{description}</p> : null}</div>
        {action}
      </div>
    </div>
  );
}

export function LoadingResults({ label = "Chargement des publications synthétiques…" }: { readonly label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="demo-loading">
      <p>{label}</p>
      {[0, 1].map((item) => <Card className="demo-loading-card" key={item}><Skeleton className="demo-skeleton-title" /><Skeleton /><Skeleton className="demo-skeleton-short" /></Card>)}
    </div>
  );
}

export function StatePanel({ tone = "info", title, children, action }: {
  readonly tone?: "info" | "warning" | "danger";
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return <Card className="demo-state"><Banner tone={tone}>{title}</Banner><div>{children}</div>{action}</Card>;
}
