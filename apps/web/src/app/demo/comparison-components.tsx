import { Banner, Button } from "@auto-world/design-system/primitives";
import type { DemoCatalogResponseV2, DemoEvidence, DemoResultV2, DemoSearchResponseV2 } from "@auto-world/demo-search-contract";

import { comparisonConflicts, comparisonRows, type ComparisonEntry } from "../../demo/comparison";
import { resolveDescription } from "../../demo/catalog";
import { availabilityLabel, formatPrice, ScreenHeader, StatePanel } from "./demo-components";

type ComparisonField = ReturnType<typeof comparisonRows>[number]["field"];
type ComparisonStatus = ReturnType<typeof comparisonRows>[number]["status"];

const fieldLabels: Record<ComparisonField, string> = {
  availability: "Disponibilité de la publication",
  make: "Marque fictive déclarée",
  model: "Modèle fictif déclaré",
  firstRegistrationYear: "Première immatriculation fictive",
  price: "Prix observé",
  mileage: "Kilométrage observé",
};

const statusLabels: Record<ComparisonStatus, string> = {
  same: "Identique",
  different: "Différences",
  incomplete: "Incomplet",
  incompatible: "Non comparable",
  insufficient: "Incomplet",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function selectedObservation(result: DemoResultV2, field: "price" | "mileage"): DemoEvidence | undefined {
  const selected = result[field];
  if (selected.status === "unavailable") return undefined;
  return result.evidence.find((item) => item.field === field && item.evidenceId === selected.evidenceId);
}

function authoredMetadata(result: DemoResultV2) {
  const description = result.description;
  if (description.status === "unavailable") return undefined;
  return result.descriptionEvidence.find((item) => item.evidenceId === description.evidenceId);
}

function formatComparisonPrice(result: DemoResultV2) {
  if (result.price.status === "unavailable") return formatPrice(result);
  const { amountMinor, currency } = result.price.value;
  const resolved = new Intl.NumberFormat("fr-FR", { style: "currency", currency }).resolvedOptions();
  const digits = resolved.maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits);
  const exact = BigInt(amountMinor);
  const whole = exact / scale;
  const fraction = (exact % scale).toString().padStart(digits, "0");
  const formatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return formatter.formatToParts(whole).map((part) => part.type === "fraction" ? fraction : part.value).join("");
}

function formatExactNumber(value: number) {
  const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 20 });
  const parts = formatter.formatToParts(value);
  const normalized = parts.map((part) => {
    if (part.type === "group") return "";
    if (part.type === "decimal") return ".";
    if (part.type === "minusSign") return "-";
    return part.type === "integer" || part.type === "fraction" ? part.value : "";
  }).join("");
  return Number(normalized) === value ? parts.map((part) => part.value).join("") : String(value);
}

function ObservationMetadata({ result, field }: { readonly result: DemoResultV2; readonly field: "price" | "mileage" }) {
  const observation = selectedObservation(result, field);
  if (observation === undefined) return <span className="demo-comparison-meta">Observation liée indisponible.</span>;
  return (
    <span className="demo-comparison-meta">
      Observé le <time dateTime={observation.observedAt}>{formatDate(observation.observedAt)}</time>
      {" · "}Confiance {new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 }).format(observation.confidenceBps / 10_000)}
    </span>
  );
}

function AuthoredMetadata({ result }: { readonly result: DemoResultV2 }) {
  const evidence = authoredMetadata(result);
  if (evidence === undefined) return <span className="demo-comparison-meta">Déclaration synthétique non disponible.</span>;
  return (
    <span className="demo-comparison-meta">
      Marque, modèle et année : déclaration issue d’une fixture synthétique, non vérifiée. Déclaré le <time dateTime={evidence.capturedAt}>{formatDate(evidence.capturedAt)}</time>.
    </span>
  );
}

function ComparisonValue({ entry, field, catalog }: {
  readonly entry: ComparisonEntry;
  readonly field: ComparisonField;
  readonly catalog?: DemoCatalogResponseV2;
}) {
  const { result } = entry;
  if (field === "availability") return <span>{availabilityLabel(result.availability)}</span>;

  if (field === "price") {
    if (result.price.status === "unavailable") return <span>Prix non disponible</span>;
    return <><span className="demo-comparison-value">{formatComparisonPrice(result)}</span><ObservationMetadata result={result} field="price" /></>;
  }

  if (field === "mileage") {
    if (result.mileage.status === "unavailable") return <span>Kilométrage non disponible</span>;
    return <><span className="demo-comparison-value">{formatExactNumber(result.mileage.value.amount)} {result.mileage.value.unit}</span><ObservationMetadata result={result} field="mileage" /></>;
  }

  if (result.description.status === "unavailable") return <span>Déclaration synthétique non disponible</span>;
  const description = resolveDescription(catalog, result.description.value);
  const value = description === undefined
    ? "Déclaration indisponible"
    : field === "firstRegistrationYear"
      ? String(description.firstRegistrationYear)
      : field === "make"
        ? description.makeLabel
        : description.modelLabel;
  return <><span className="demo-comparison-value">{value}</span>{field === "firstRegistrationYear" ? <AuthoredMetadata result={result} /> : null}</>;
}

export interface ComparisonScreenProps {
  readonly entries: readonly ComparisonEntry[];
  readonly response?: DemoSearchResponseV2;
  readonly catalog?: DemoCatalogResponseV2;
  readonly online: boolean;
  readonly refreshError?: string;
  readonly onReturn: () => void;
  readonly onRemove: (entry: ComparisonEntry) => void;
}

export function ComparisonScreen({ entries, response, catalog, online, refreshError, onReturn, onRemove }: ComparisonScreenProps) {
  const rows = comparisonRows(entries, catalog);
  const conflicts = entries.reduce((state, { result }) => {
    const next = comparisonConflicts(result);
    return { observations: state.observations || next.observations, descriptions: state.descriptions || next.descriptions };
  }, { observations: false, descriptions: false });

  return (
    <section aria-labelledby="demo-screen-title">
      <ScreenHeader
        title="Comparer"
        description="Comparaison factuelle de publications synthétiques, sans classement ni identité véhicule déduite."
        backLabel={response === undefined ? "Retour à la recherche" : "Retour aux résultats"}
        onBack={onReturn}
      />
      {response === undefined || entries.length === 0 ? (
        <StatePanel title="Aucune publication à comparer">
          <p>Sélectionnez deux ou trois publications depuis les résultats. La sélection n’est pas conservée après un rechargement.</p>
        </StatePanel>
      ) : (
        <>
          <div className="demo-comparison-snapshot">
            <p>Valeurs de cette recherche, non actualisées automatiquement.</p>
            <p>Données arrêtées au <time dateTime={response.dataAsOf}>{formatDate(response.dataAsOf)}</time>.</p>
          </div>
          {response.state === "partial" ? <Banner role="note" tone="warning">La projection est partielle : la comparaison porte uniquement sur les publications affichées.</Banner> : null}
          {response.state === "stale" ? <Banner role="note" tone="warning">Cet instant de démonstration est ancien. Les valeurs restent celles de la recherche acceptée.</Banner> : null}
          {!online ? <Banner role="note" tone="warning">Vous êtes hors connexion. Ces données ont déjà été chargées ; aucune actualisation en direct n’est effectuée.</Banner> : null}
          {refreshError ? <Banner role="alert" tone="danger">La dernière actualisation a échoué. {refreshError} Les valeurs ci-dessous restent celles de la recherche acceptée.</Banner> : null}
          {conflicts.observations || conflicts.descriptions ? <Banner role="note" tone="warning">{conflicts.observations && conflicts.descriptions ? "Plusieurs valeurs et déclarations existent dans les historiques" : conflicts.observations ? "Plusieurs valeurs existent dans l’historique des observations" : "Plusieurs déclarations existent dans l’historique synthétique"}. Consultez le détail pour voir leurs dates et provenances séparées.</Banner> : null}
          {entries.length < 2 ? <Banner role="status" tone="info">Une seconde publication est nécessaire pour établir les ressemblances et différences. La publication restante reste visible ci-dessous.</Banner> : null}
          <p className="demo-comparison-hint" id="demo-comparison-hint">Sur écran étroit, faites défiler le tableau horizontalement pour consulter toutes les publications.</p>
          <div className="demo-comparison-scroll" role="region" aria-labelledby="demo-screen-title" aria-describedby="demo-comparison-hint" tabIndex={0}>
            <table className="demo-comparison-table">
              <thead>
                <tr>
                  <th scope="col">Caractéristique</th>
                  {entries.map((entry) => <th scope="col" key={entry.result.listingId}>Publication {String(entry.index + 1).padStart(2, "0")}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.field} data-comparison-field={row.field}>
                    <th scope="row"><span>{fieldLabels[row.field]}</span><span className={`demo-comparison-status demo-comparison-status-${row.status}`}>{statusLabels[row.status]}</span></th>
                    {entries.map((entry) => <td key={entry.result.listingId}><ComparisonValue entry={entry} field={row.field} catalog={catalog} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="demo-comparison-remove" aria-label="Retirer une publication de la comparaison">
            {entries.map((entry) => (
              <Button id={`demo-comparison-remove-${entry.index}`} variant="secondary" key={entry.result.listingId} onClick={() => onRemove(entry)}>
                Retirer la publication {String(entry.index + 1).padStart(2, "0")}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
