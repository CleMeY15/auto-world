import { Banner, Button } from "@auto-world/design-system/primitives";
import type { DemoCatalogResponseV2, DemoSearchResponseV2 } from "@auto-world/demo-search-contract";

import type { ComparisonLinkDecodeResult } from "../../demo/comparison-link";
import type { ComparisonEntry } from "../../demo/comparison";
import { matchingCatalog } from "../../demo/catalog";
import { ComparisonTable } from "./comparison-components";
import { LoadingResults, ScreenHeader, StatePanel } from "./demo-components";

export interface ComparisonLinkSlotState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly message: string;
}

export type ComparisonLinkLoadState =
  | { readonly status: "idle" | "loading" | "incomplete" | "incompatible"; readonly slots: readonly ComparisonLinkSlotState[] }
  | { readonly status: "ready"; readonly slots: readonly ComparisonLinkSlotState[]; readonly entries: readonly ComparisonEntry[]; readonly responses: readonly DemoSearchResponseV2[] };

export function ComparisonLinkReview({ link, load, catalog, online, slow, onLoad, onReturn }: {
  readonly link: ComparisonLinkDecodeResult;
  readonly load: ComparisonLinkLoadState;
  readonly catalog?: DemoCatalogResponseV2;
  readonly online: boolean;
  readonly slow: boolean;
  readonly onLoad: () => void;
  readonly onReturn: () => void;
}) {
  const valid = link.status === "valid";
  const compatibleCatalog = load.status === "ready"
    ? matchingCatalog(catalog, load.responses[0])
    : undefined;

  return (
    <section id="demo-received-comparison" data-status={valid ? load.status : link.status} aria-labelledby="demo-screen-title" className="demo-received-search">
      <ScreenHeader title="Comparaison reçue" description="Vérifiez les publications demandées avant de relire leurs détails actuels." />
      {!valid ? (
        <StatePanel title="Lien indisponible" action={<Button onClick={onReturn}>Retour à la recherche</Button>}>
          <p>{link.status === "unsupported" ? "Ce lien a été créé avec une version non prise en charge. Demandez un nouveau lien." : "Ce lien de comparaison est invalide ou incomplet. Demandez un nouveau lien."}</p>
        </StatePanel>
      ) : (
        <div className="demo-detail">
          <p>Ce lien contient uniquement une liste ordonnée de références de publications synthétiques, sans identifier de véhicules réels. Il ne fige ni leurs valeurs ni leur disponibilité.</p>
          <p className="demo-field-hint">Cette démo est locale : chaque détail est relu sur cet ordinateur uniquement après votre action.</p>
          {load.status !== "ready" ? (
            <ol className="demo-history-list" aria-label="Publications demandées">
              {load.slots.map((slot, index) => (
                <li key={index} data-comparison-slot={index} data-status={slot.status}>
                  <strong>Publication {String(index + 1).padStart(2, "0")}</strong>
                  <div className="demo-comparison-meta">{slot.message}</div>
                </li>
              ))}
            </ol>
          ) : null}
          {load.status === "loading" ? <div id="demo-comparison-link-loading" role="status"><LoadingResults label={slow ? "La lecture des publications prend plus de temps que prévu…" : "Lecture des publications en cours…"} /></div> : null}
          {load.status === "incomplete" ? <Banner id="demo-comparison-link-status" role="alert" tone="danger">La comparaison ne peut pas être affichée : au moins une publication n’a pas pu être relue. Réessayez toutes les lectures.</Banner> : null}
          {load.status === "incompatible" ? <Banner id="demo-comparison-link-status" role="alert" tone="warning">Les données de démonstration ou la version du catalogue ont changé entre les lectures. Relisez toutes les publications avant de comparer.</Banner> : null}
          {load.status === "ready" ? (
            <>
              <p>Chaque colonne présente une lecture indépendante, à l’instant indiqué. Ces valeurs ne sont pas actualisées automatiquement.</p>
              {!online ? <Banner role="note" tone="warning">Vous êtes hors connexion. Les données déjà chargées restent consultables ; aucune actualisation automatique n’est effectuée.</Banner> : null}
              {compatibleCatalog === undefined ? <Banner role="note" tone="warning">Les libellés de marque et de modèle ne correspondent pas au catalogue chargé. Ils restent indiqués comme indisponibles ; les observations de prix et de kilométrage restent consultables.</Banner> : null}
              <ComparisonTable entries={load.entries} catalog={compatibleCatalog} responses={load.responses} />
            </>
          ) : null}
          <div className="demo-form-actions">
            <Button
              id={load.status === "idle" || load.status === "loading" ? "demo-comparison-link-load" : "demo-comparison-link-reread"}
              loading={load.status === "loading"}
              disabled={load.status === "loading"}
              onClick={onLoad}
            >
              {load.status === "loading" ? "Lecture…" : load.status === "idle" ? "Charger la comparaison" : "Relire toutes les publications"}
            </Button>
            <Button variant="secondary" onClick={onReturn}>Retour à la recherche</Button>
          </div>
        </div>
      )}
    </section>
  );
}
