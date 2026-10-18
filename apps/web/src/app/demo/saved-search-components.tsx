import { Banner, Button, Card } from "@auto-world/design-system/primitives";
import type { DemoCatalogResponseV2, DemoSearchSort } from "@auto-world/demo-search-contract";

import {
  matchingSavedSearchCatalog,
  getSavedSearchKey,
  SAVED_SEARCH_LIMIT,
  savedSearchToFilterInput,
  type SavedSearch,
  type SavedSearchCriteria,
} from "../../demo/saved-searches";

const sortLabels: Readonly<Record<DemoSearchSort, string>> = Object.freeze({
  listing_asc: "Ordre stable de publication",
  price_asc: "Prix croissant (EUR d’abord)",
  price_desc: "Prix décroissant (EUR d’abord)",
  mileage_asc: "Kilométrage croissant (km d’abord)",
  mileage_desc: "Kilométrage décroissant (km d’abord)",
});

export function SearchCriteriaSummary({ criteria, catalog }: { readonly criteria: SavedSearchCriteria; readonly catalog?: DemoCatalogResponseV2 }) {
  const query = criteria.query;
  const compatibleCatalog = matchingSavedSearchCatalog(criteria, catalog);
  const exactInput = savedSearchToFilterInput(criteria, compatibleCatalog, true);
  const make = compatibleCatalog?.taxonomyRelease.makes.find((item) => item.makeId === query.makeId);
  const model = compatibleCatalog?.taxonomyRelease.models.find((item) => item.makeId === query.makeId && item.modelId === query.modelId);

  return (
    <dl className="demo-saved-search-criteria">
      {make ? <div><dt>Marque fictive</dt><dd>{make.primaryName.value}</dd></div> : null}
      {model ? <div><dt>Modèle fictif</dt><dd>{model.primaryName.value}</dd></div> : null}
      {exactInput?.firstRegistrationYear ? <div><dt>Première immatriculation fictive</dt><dd>{exactInput.firstRegistrationYear}</dd></div> : null}
      {exactInput?.priceMaxEUR ? <div><dt>Budget maximum</dt><dd>{exactInput.priceMaxEUR} €</dd></div> : null}
      {exactInput?.mileageMaxKm ? <div><dt>Kilométrage maximum</dt><dd>{exactInput.mileageMaxKm} km</dd></div> : null}
      <div><dt>Tri</dt><dd>{sortLabels[query.sort]}</dd></div>
    </dl>
  );
}

export function SavedSearchesSection({
  searches,
  catalog,
  catalogPending,
  enabled,
  readOnly,
  emptyCopy,
  showCount,
  onLoad,
  onRemove,
}: {
  readonly searches: readonly SavedSearch[];
  readonly catalog?: DemoCatalogResponseV2;
  readonly catalogPending: boolean;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly emptyCopy?: string;
  readonly showCount: boolean;
  readonly onLoad: (search: SavedSearch, omitIdentity: boolean) => void;
  readonly onRemove: (search: SavedSearch, index: number) => void;
}) {
  return (
    <section aria-labelledby="demo-saved-searches-title" className="demo-saved-section">
      <div className="demo-section-heading">
        <h2 id="demo-saved-searches-title" tabIndex={-1}>Recherches enregistrées{showCount ? ` (${searches.length} sur ${SAVED_SEARCH_LIMIT})` : ""}</h2>
        <p>Chargez les critères, puis lancez vous-même la recherche.</p>
      </div>
      {readOnly ? <p className="demo-field-hint">Ces recherches sont en lecture seule. Leur suppression est désactivée afin de préserver les données existantes.</p> : null}
      {searches.length === 0 ? (emptyCopy ? <p className="demo-section-empty">{emptyCopy}</p> : null) : (
        <ol className="demo-saved-search-list">
          {searches.map((search, index) => {
            const hasIdentity = search.criteria.query.makeId !== undefined || search.criteria.query.modelId !== undefined;
            const compatibleCatalog = matchingSavedSearchCatalog(search.criteria, catalog);
            const identityUnavailable = hasIdentity && compatibleCatalog === undefined && !catalogPending;
            return (
              <li key={getSavedSearchKey(search.criteria)}>
                <Card className="demo-saved-search">
                  <div className="demo-saved-search-copy">
                    <h3 id={`demo-saved-search-name-${index}`} tabIndex={-1}>{search.name}</h3>
                    <SearchCriteriaSummary criteria={search.criteria} catalog={catalog} />
                    {hasIdentity && catalogPending ? <p className="demo-field-hint" role="status">Vérification de la marque et du modèle enregistrés…</p> : null}
                    {identityUnavailable ? <Banner role="note" tone="warning">La marque ou le modèle de cette recherche n’est plus disponible dans le catalogue validé.</Banner> : null}
                  </div>
                  <div className="demo-card-actions">
                    {identityUnavailable ? (
                      <Button disabled={!enabled} id={`demo-saved-search-load-${index}`} onClick={() => onLoad(search, true)}>Charger sans marque ni modèle</Button>
                    ) : (
                      <Button disabled={!enabled || (hasIdentity && catalogPending)} id={`demo-saved-search-load-${index}`} onClick={() => onLoad(search, false)}>Charger les critères</Button>
                    )}
                    <Button disabled={readOnly} id={`demo-saved-search-remove-${index}`} variant="secondary" onClick={() => onRemove(search, index)}>Supprimer</Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
