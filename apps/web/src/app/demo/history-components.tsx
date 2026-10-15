import { Banner } from "@auto-world/design-system/primitives";
import type { DemoEvidence, DemoResultV2, DemoSearchResponseV2 } from "@auto-world/demo-search-contract";
import {
  formatExactNumber,
  formatObservationConfidence,
  formatObservationTimestamp,
  formatObservedPrice,
  observationHistory,
} from "../../demo/observation-history";

export function DetailSnapshot({ response, online }: { readonly response: DemoSearchResponseV2; readonly online: boolean }) {
  return (
    <div className="demo-detail-snapshot">
      <p>Données arrêtées au <time dateTime={response.dataAsOf}>{formatObservationTimestamp(response.dataAsOf)}</time>.</p>
      <p>Valeurs disponibles à cet instant pour cette publication, sans actualisation automatique.</p>
      {response.state === "partial" ? <Banner role="note" tone="warning">Cette lecture est partielle : certaines données peuvent manquer.</Banner> : null}
      {response.state === "stale" ? <Banner role="note" tone="warning">Ces données de démonstration sont anciennes. Elles correspondent à l’instant indiqué.</Banner> : null}
      {!online ? <Banner role="note" tone="warning">Vous êtes hors connexion. Les données déjà chargées restent consultables.</Banner> : null}
    </div>
  );
}

function ObservationValue({ evidence }: { readonly evidence: DemoEvidence }) {
  const value = evidence.field === "price"
    ? formatObservedPrice(evidence.value, "code")
    : `${formatExactNumber(evidence.value.amount)} ${evidence.value.unit}`;
  return (
    <div className="demo-history-row">
      <strong data-observation-value>{value}</strong>
      <span>Observé le <time dateTime={evidence.observedAt}>{formatObservationTimestamp(evidence.observedAt)}</time></span>
      <span>Confiance de l’observation : {formatObservationConfidence(evidence.confidenceBps)}</span>
    </div>
  );
}

function FieldHistory({ result, field }: { readonly result: DemoResultV2; readonly field: "price" | "mileage" }) {
  const history = observationHistory(result, field);
  const name = field === "price" ? "prix" : "kilométrage";
  return (
    <section className="demo-history-field" data-history-field={field} aria-labelledby={`demo-history-${field}-title`}>
      <h3 id={`demo-history-${field}-title`}>{field === "price" ? "Prix observé" : "Kilométrage observé"}</h3>
      {history.selected ? (
        <div className="demo-history-selected">
          <p className="demo-history-label">Observation affichée</p>
          <ObservationValue evidence={history.selected} />
        </div>
      ) : <p className="demo-history-note">{field === "price" ? "Prix non disponible. Aucune observation de prix n’est disponible pour cette publication." : "Kilométrage non disponible. Aucune observation de kilométrage n’est disponible pour cette publication."}</p>}
      {history.multipleRepresentations ? <p className="demo-history-note">{field === "price" ? "Plusieurs devises figurent dans cet historique. Les montants sont affichés sans conversion." : "Plusieurs unités figurent dans cet historique. Les distances sont affichées sans conversion."}</p> : null}
      {history.sameInstant ? <p className="demo-history-note">Plusieurs observations portent le même instant (date et heure). Elles restent distinctes ; « Observation affichée » indique celle retenue dans cette réponse.</p> : null}
      {history.other.length > 0 ? (
        <details className="demo-history-disclosure" data-history-disclosure={field}>
          <summary>Historique du {name} <span>({history.other.length} {history.other.length === 1 ? "autre observation" : "autres observations"})</span></summary>
          <ol className="demo-history-list" role="list" aria-label={`Autres observations de ${name}`}>
            {history.other.map((evidence) => (
              <li key={evidence.evidenceId}>
                <p className="demo-history-label">Observation conservée</p>
                <ObservationValue evidence={evidence} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

export function ObservationHistory({ result }: { readonly result: DemoResultV2 }) {
  return (
    <>
      <div className="demo-section-heading">
        <h2 id="evidence-title">Historique des observations</h2>
        <p>Prix et kilométrage de cette publication synthétique. Chaque observation conserve sa date et son niveau de confiance ; cet historique n’est pas un rapport véhicule.</p>
      </div>
      <div className="demo-history-fields">
        <FieldHistory result={result} field="price" />
        <FieldHistory result={result} field="mileage" />
      </div>
    </>
  );
}
