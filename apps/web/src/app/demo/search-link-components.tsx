import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Field } from "@auto-world/design-system/primitives";
import type { DemoCatalogResponseV2 } from "@auto-world/demo-search-contract";

import { recordAnalyticsEvent } from "../../demo/analytics";
import { buildSearchLink, type SearchLinkDecodeResult } from "../../demo/search-link";
import { matchingSavedSearchCatalog, type SavedSearchCriteria } from "../../demo/saved-searches";
import { ScreenHeader, StatePanel } from "./demo-components";
import { SearchCriteriaSummary } from "./saved-search-components";

export function SearchLinkCreator({ criteria }: { readonly criteria: SavedSearchCriteria }) {
  const [url, setUrl] = useState<string>();
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "manual" | "unavailable">("idle");
  const copyEpoch = useRef(0);
  useEffect(() => () => { copyEpoch.current += 1; }, []);

  const selectLink = useCallback(() => {
    const field = document.getElementById("demo-search-link-url") as HTMLInputElement | null;
    field?.focus();
    field?.select();
  }, []);
  const focusOpenedPanel = useCallback((node: HTMLDivElement | null) => {
    if (node) selectLink();
  }, [selectLink]);

  function createLink() {
    const next = buildSearchLink(criteria, window.location.href);
    setStatus(next === undefined ? "unavailable" : "idle");
    setUrl(next);
    recordAnalyticsEvent({ eventName: "search_link_created", screen: "results", outcome: next === undefined ? "error" : "success" });
  }

  function closeLink() {
    copyEpoch.current += 1;
    setUrl(undefined);
    setStatus("idle");
    document.getElementById("demo-search-link-start")?.focus();
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
      recordAnalyticsEvent({ eventName: "search_link_copied", screen: "results", outcome: "success" });
    } catch {
      if (copyEpoch.current !== epoch) return;
      setStatus("manual");
      selectLink();
      recordAnalyticsEvent({ eventName: "search_link_copied", screen: "results", outcome: "error" });
    }
  }

  return (
    <div className="demo-search-link">
      <Button id="demo-search-link-start" variant="secondary" aria-expanded={url !== undefined} aria-controls={url === undefined ? undefined : "demo-search-link-panel"} onClick={url === undefined ? createLink : closeLink}>Créer un lien</Button>
      {url !== undefined ? (
        <div id="demo-search-link-panel" className="demo-search-link-panel" role="region" aria-label="Lien de recherche" ref={focusOpenedPanel}>
          <p>Ce lien partage uniquement les critères de cette recherche, pas ses résultats. Toute personne qui possède le lien peut lire ces critères.</p>
          <p className="demo-field-hint">Cette démo est locale : le lien fonctionne seulement sur cet ordinateur, tant que la démo est active.</p>
          <Field id="demo-search-link-url" label="Lien de recherche" type="url" dir="ltr" readOnly value={url} spellCheck={false} autoComplete="off" onFocus={(event) => event.currentTarget.select()} />
          <div className="demo-form-actions">
            <Button id="demo-search-link-copy" loading={status === "copying"} onClick={() => { void copyLink(); }}>{status === "copying" ? "Copie…" : "Copier le lien"}</Button>
            <Button id="demo-search-link-close" variant="secondary" onClick={closeLink}>Fermer</Button>
          </div>
          <p className="demo-search-link-status" role="status">{status === "copied" ? "Lien copié." : status === "manual" ? "Copie automatique impossible. Sélectionnez le lien ci-dessus et copiez-le manuellement." : status === "copying" ? "Copie en cours… Vous pouvez aussi sélectionner le lien." : "Vous pouvez copier ce lien automatiquement ou le sélectionner manuellement."}</p>
        </div>
      ) : status === "unavailable" ? <p role="status">Le lien ne peut pas être créé. Relancez la recherche, puis réessayez.</p> : null}
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
