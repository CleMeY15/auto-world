import type { ReactNode } from "react";
import { Banner, BookmarkIcon, Button, Card, ChevronLeftIcon, Skeleton } from "@auto-world/design-system/primitives";
import type { DemoEvidence, DemoResultV1 } from "@auto-world/demo-search-contract";

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

function formatPrice(result: DemoResultV1) {
  if (result.price.status === "unavailable") return "Prix non disponible";
  const formatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: result.price.value.currency,
    maximumFractionDigits: new Intl.NumberFormat("fr-FR", { style: "currency", currency: result.price.value.currency }).resolvedOptions().maximumFractionDigits,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(result.price.value.amountMinor / (10 ** digits));
}

function formatMileage(result: DemoResultV1) {
  if (result.mileage.status === "unavailable") return "Kilométrage non disponible";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(result.mileage.value.amount)} ${result.mileage.value.unit}`;
}

function formatEvidenceValue(evidence: DemoEvidence) {
  if (evidence.field === "mileage") return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(evidence.value.amount)} ${evidence.value.unit}`;
  const formatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: evidence.value.currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(evidence.value.amountMinor / (10 ** digits));
}

function availabilityLabel(value: DemoResultV1["availability"]) {
  if (value === "active") return "Publication active";
  if (value === "withdrawn") return "Publication retirée";
  if (value === "deleted") return "Publication supprimée";
  return "Publication introuvable";
}

export function ResultSummary({ result }: { readonly result: DemoResultV1 }) {
  return (
    <dl className="demo-facts">
      <div><dt>Prix observé</dt><dd>{formatPrice(result)}</dd></div>
      <div><dt>Kilométrage observé</dt><dd>{formatMileage(result)}</dd></div>
    </dl>
  );
}

export function ResultCard({ index, result, saved, onOpen, onToggleSaved }: {
  readonly index: number;
  readonly result: DemoResultV1;
  readonly saved: boolean;
  readonly onOpen: () => void;
  readonly onToggleSaved: () => void;
}) {
  return (
    <Card className="demo-result-card">
      <div className="demo-result-copy">
        <p className="demo-status">{availabilityLabel(result.availability)}</p>
        <h3>Publication synthétique {String(index + 1).padStart(2, "0")}</h3>
        <ResultSummary result={result} />
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

export function EvidenceDetails({ result }: { readonly result: DemoResultV1 }) {
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
