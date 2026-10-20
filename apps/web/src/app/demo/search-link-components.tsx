import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Field } from "@auto-world/design-system/primitives";
import type { DemoCatalogResponseV2 } from "@auto-world/demo-search-contract";

import { recordAnalyticsEvent } from "../../demo/analytics";
import { buildComparisonLink } from "../../demo/comparison-link";
import { buildPublicationLink } from "../../demo/publication-link";
import { buildSearchLink, type SearchLinkDecodeResult } from "../../demo/search-link";
import { matchingSavedSearchCatalog, type SavedSearchCriteria } from "../../demo/saved-searches";
import { ScreenHeader, StatePanel } from "./demo-components";
import { SearchCriteriaSummary } from "./saved-search-components";

export function SearchLinkCreator({ criteria }: { readonly criteria: SavedSearchCriteria }) {
  return <LinkCreator target={{ kind: "search", criteria }} />;
}

export function PublicationLinkCreator({ listingId }: { readonly listingId: string }) {
  return <LinkCreator key={listingId} target={{ kind: "publication", listingId }} />;
}

export function ComparisonLinkCreator({ listingIds }: { readonly listingIds: readonly string[] }) {
  return <LinkCreator key={listingIds.join("\u0000")} target={{ kind: "comparison", listingIds }} />;
}

type LinkTarget =
  | { readonly kind: "search"; readonly criteria: SavedSearchCriteria }
  | { readonly kind: "publication"; readonly listingId: string }
  | { readonly kind: "comparison"; readonly listingIds: readonly string[] };

function LinkCreator({ target }: { readonly target: LinkTarget }) {
  const prefix = target.kind === "search" ? "demo-search-link" : target.kind === "publication" ? "demo-publication-link" : "demo-comparison-link";
  const label = target.kind === "search" ? "Lien de recherche" : target.kind === "publication" ? "Lien de publication" : "Lien de comparaison";
  const screen = target.kind === "search" ? "results" : target.kind === "publication" ? "detail" : "compare";
  const [url, setUrl] = useState<string>();
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "manual" | "unavailable">("idle");
  const copyEpoch = useRef(0);
  useEffect(() => () => { copyEpoch.current += 1; }, []);

  const selectLink = useCallback(() => {
    const field = document.getElementById(`${prefix}-url`) as HTMLInputElement | null;
    field?.focus();
    field?.select();
  }, [prefix]);
  const focusOpenedPanel = useCallback((node: HTMLDivElement | null) => {
    if (node) selectLink();
  }, [selectLink]);

  function createLink() {
    const next = target.kind === "search"
      ? buildSearchLink(target.criteria, window.location.href)
      : target.kind === "publication"
        ? buildPublicationLink(target.listingId, window.location.href)
        : buildComparisonLink(target.listingIds, window.location.href);
    setStatus(next === undefined ? "unavailable" : "idle");
    setUrl(next);
    recordAnalyticsEvent({ eventName: target.kind === "search" ? "search_link_created" : target.kind === "publication" ? "listing_link_created" : "comparison_link_created", screen, outcome: next === undefined ? "error" : "success" });
  }

  function closeLink() {
    copyEpoch.current += 1;
    setUrl(undefined);
    setStatus("idle");
    document.getElementById(`${prefix}-start`)?.focus();
  }

  async function copyLink() {
    if (url === undefined || status === "copying") return;
    const epoch = ++copyEpoch.current;
    setStatus("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      if (copyEpoch.current !== epoch) return;
      setStatus("copied");
      recordAnalyticsEvent({ eventName: target.kind === "search" ? "search_link_copied" : target.kind === "publication" ? "listing_link_copied" : "comparison_link_copied", screen, outcome: "success" });
    } catch {
      if (copyEpoch.current !== epoch) return;
      setStatus("manual");
      selectLink();
      recordAnalyticsEvent({ eventName: target.kind === "search" ? "search_link_copied" : target.kind === "publication" ? "listing_link_copied" : "comparison_link_copied", screen, outcome: "error" });
    }
  }

  return (
    <div className="demo-search-link">
      <Button id={`${prefix}-start`} variant="secondary" aria-expanded={url !== undefined} aria-controls={url === undefined ? undefined : `${prefix}-panel`} onClick={url === undefined ? createLink : closeLink}>Créer un lien</Button>
      {url !== undefined ? (
        <div id={`${prefix}-panel`} className="demo-search-link-panel" role="region" aria-label={label} ref={focusOpenedPanel}>
          <p>{target.kind === "search" ? "Ce lien partage uniquement les critères de cette recherche, pas ses résultats. Toute personne qui possède le lien peut lire ces critères." : target.kind === "publication" ? "Ce lien pointe vers cette publication synthétique. Il ne fige ni les valeurs ni sa disponibilité et n’identifie pas un véhicule réel." : "Ce lien pointe vers ces publications synthétiques dans l’ordre affiché. Il ne fige ni leurs valeurs ni leur disponibilité et n’identifie pas des véhicules réels."}</p>
          <p className="demo-field-hint">{target.kind === "search" ? "Cette démo est locale : le lien fonctionne seulement sur cet ordinateur, tant que la démo est active." : "Cette démo est locale : le lien fonctionne uniquement sur cet ordinateur, tant que la démo est active."}</p>
          <Field id={`${prefix}-url`} label={label} type="url" dir="ltr" readOnly value={url} spellCheck={false} autoComplete="off" onFocus={(event) => event.currentTarget.select()} />
          <div className="demo-form-actions">
            <Button id={`${prefix}-copy`} loading={status === "copying"} onClick={() => { void copyLink(); }}>{status === "copying" ? "Copie…" : "Copier le lien"}</Button>
            <Button id={`${prefix}-close`} variant="secondary" onClick={closeLink}>Fermer</Button>
          </div>
          <p className="demo-search-link-status" role="status">{status === "copied" ? "Lien copié." : status === "manual" ? "Copie automatique impossible. Sélectionnez le lien ci-dessus et copiez-le manuellement." : status === "copying" ? "Copie en cours… Vous pouvez aussi sélectionner le lien." : "Vous pouvez copier ce lien automatiquement ou le sélectionner manuellement."}</p>
        </div>
      ) : status === "unavailable" ? <p role="status">{target.kind === "search" ? "Le lien ne peut pas être créé. Relancez la recherche, puis réessayez." : target.kind === "publication" ? "Le lien ne peut pas être créé. Rechargez ce détail, puis réessayez." : "Le lien ne peut pas être créé. Revenez aux résultats, puis recréez la comparaison."}</p> : null}
    </div>
  );
}

export function SearchLinkReview({ link, catalog, catalogPending, onLoad, onIgnore }: {
  readonly link: SearchLinkDecodeResult;
  readonly catalog?: DemoCatalogResponseV2;
  readonly catalogPending: boolean;
  readonly onLoad: (criteria: SavedSearchCriteria, omitIdentity: boolean) => void;
  readonly onIgnore: () => void;
}) {
  const criteria = link.status === "valid" ? link.criteria : undefined;
  const hasIdentity = criteria?.binding !== undefined;
  const compatibleCatalog = criteria === undefined ? undefined : matchingSavedSearchCatalog(criteria, catalog);
  const unavailableIdentity = hasIdentity && compatibleCatalog === undefined && !catalogPending;
  return (
    <section aria-labelledby="demo-screen-title" className="demo-received-search">
      <ScreenHeader title="Recherche reçue" description="Vérifiez les critères partagés avant de les charger. Aucun résultat n’a été partagé." />
      {criteria === undefined ? (
        <StatePanel title="Lien indisponible" action={<Button onClick={onIgnore}>Ignorer le lien</Button>}>
          <p>{link.status === "unsupported" ? "Ce lien a été créé avec une version non prise en charge. Demandez un nouveau lien." : "Ce lien de recherche est invalide ou incomplet. Demandez un nouveau lien."}</p>
        </StatePanel>
      ) : (
        <div className="demo-received-search-content">
          <SearchCriteriaSummary criteria={criteria} catalog={catalog} />
          {hasIdentity && catalogPending ? <p role="status">Vérification de la marque et du modèle…</p> : null}
          {unavailableIdentity ? <Banner role="note" tone="warning">La marque et le modèle de ce lien ne sont pas disponibles dans le catalogue de cette démo. Les autres critères peuvent être chargés.</Banner> : null}
          <p>Charger les critères remplit le formulaire sans lancer la recherche.</p>
          <div className="demo-form-actions">
            <Button id="demo-search-link-load" disabled={hasIdentity && catalogPending} onClick={() => onLoad(criteria, unavailableIdentity)}>{unavailableIdentity ? "Charger sans marque ni modèle" : "Charger les critères"}</Button>
            <Button variant="secondary" onClick={onIgnore}>Ignorer le lien</Button>
          </div>
        </div>
      )}
    </section>
  );
}
