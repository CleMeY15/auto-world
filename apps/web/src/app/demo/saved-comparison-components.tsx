import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Banner, Button, Card, Field } from "@auto-world/design-system/primitives";

import { decodeComparisonLinkFragment } from "../../demo/comparison-link";

export interface SavedComparisonItem {
  readonly name: string;
  readonly fragment: string;
}

export type SaveComparisonResult = "saved" | "invalid" | "duplicate" | "full" | "readonly" | "stale";

function focusAfterRender(id: string) {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById(id)?.focus()));
}

export function SaveComparisonControl({
  fragment,
  existingIndex,
  full,
  readOnly,
  onSave,
  onSaved,
  onViewSaved,
}: {
  readonly fragment: string;
  readonly existingIndex: number;
  readonly full: boolean;
  readonly readOnly: boolean;
  readonly onSave: (name: string, fragment: string) => SaveComparisonResult;
  readonly onSaved: () => void;
  readonly onViewSaved: (index?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<Exclude<SaveComparisonResult, "saved">>();

  function close() {
    setOpen(false);
    setName("");
    setError(undefined);
    focusAfterRender("demo-save-comparison-start");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = onSave(name, fragment);
    if (result !== "saved") {
      setError(result);
      if (result === "invalid") focusAfterRender("demo-saved-comparison-name");
      return;
    }
    setOpen(false);
    setName("");
    setError(undefined);
    onSaved();
    focusAfterRender("demo-save-comparison-start");
  }

  return (
    <div className="demo-save-comparison">
      <p className="demo-field-hint">Ce raccourci conserve uniquement les références de cette démo dans ce navigateur. Les valeurs actuelles seront relues seulement après votre action « Charger la comparaison ».</p>
      {existingIndex >= 0 ? (
        <Button id="demo-save-comparison-start" variant="secondary" onClick={() => onViewSaved(existingIndex)}>Voir la comparaison enregistrée</Button>
      ) : full || readOnly ? (
        <>
          <Button id="demo-save-comparison-start" variant="secondary" onClick={() => onViewSaved()}>Gérer les comparaisons</Button>
          <p className="demo-field-hint">{full ? "Vous avez atteint la limite de 10 comparaisons enregistrées." : "Ces données enregistrées sont en lecture seule."}</p>
        </>
      ) : !open ? (
        <Button id="demo-save-comparison-start" variant="secondary" aria-expanded="false" onClick={() => { setOpen(true); setError(undefined); focusAfterRender("demo-saved-comparison-name"); }}>Enregistrer cette comparaison</Button>
      ) : (
        <form className="demo-save-comparison-form" noValidate onSubmit={submit}>
          <Field id="demo-saved-comparison-name" name="comparisonName" label="Nom de la comparaison" value={name} onChange={(event) => { setName(event.target.value); setError(undefined); }} error={error === "invalid" ? "Choisissez un nom de 1 à 60 caractères, sans caractères de contrôle." : undefined} autoComplete="off" />
          {error === "duplicate" ? <Banner role="alert" tone="warning">Cette comparaison est déjà enregistrée.</Banner> : null}
          {error === "full" ? <Banner role="alert" tone="warning">Vous avez atteint la limite de 10 comparaisons enregistrées.</Banner> : null}
          {error === "readonly" ? <Banner role="alert" tone="warning">Ces données enregistrées sont en lecture seule. Gérez-les depuis l’écran Enregistrés.</Banner> : null}
          <div className="demo-form-actions">
            <Button type="submit">Enregistrer</Button>
            <Button type="button" variant="secondary" onClick={close}>Annuler</Button>
            {error === "duplicate" ? <Button type="button" variant="secondary" onClick={() => onViewSaved(existingIndex >= 0 ? existingIndex : undefined)}>Voir la comparaison enregistrée</Button> : null}
            {error === "full" || error === "readonly" ? <Button type="button" variant="secondary" onClick={() => onViewSaved()}>Gérer les comparaisons</Button> : null}
          </div>
        </form>
      )}
    </div>
  );
}

export function SavedComparisonsSection({
  comparisons,
  enabled,
  readOnly,
  emptyCopy,
  showCount,
  undoNotice,
  onOpen,
  onRemove,
}: {
  readonly comparisons: readonly SavedComparisonItem[];
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly emptyCopy?: string;
  readonly showCount: boolean;
  readonly undoNotice?: ReactNode;
  readonly onOpen: (comparison: SavedComparisonItem, index: number) => void;
  readonly onRemove: (comparison: SavedComparisonItem, index: number) => void;
}) {
  return (
    <section aria-labelledby="demo-saved-comparisons-title" className="demo-saved-section">
      <div className="demo-section-heading">
        <h2 id="demo-saved-comparisons-title" tabIndex={-1}>
          Comparaisons enregistrées
          {showCount ? <span className="demo-section-count"> ({comparisons.length} sur 10)</span> : null}
        </h2>
        <p>Ouvrez un raccourci, vérifiez ses références, puis chargez explicitement les valeurs actuelles.</p>
      </div>
      {undoNotice}
      <p className="demo-field-hint">Ces raccourcis restent dans ce navigateur et désignent les données actuellement disponibles dans cette démo. Ils ne constituent ni un historique figé ni une identité de véhicule réel.</p>
      {readOnly ? <p className="demo-field-hint">Ces comparaisons sont en lecture seule. Leur ouverture et leur suppression sont désactivées afin de préserver les données existantes.</p> : null}
      {comparisons.length === 0 ? (emptyCopy ? <p className="demo-section-empty">{emptyCopy}</p> : null) : (
        <ol className="demo-saved-search-list">
          {comparisons.map((comparison, index) => {
            const decoded = decodeComparisonLinkFragment(comparison.fragment);
            const count = decoded.status === "valid" ? decoded.listingIds.length : 0;
            return (
              <li key={comparison.fragment}>
                <Card className="demo-saved-comparison">
                  <div className="demo-saved-search-copy">
                    <h3 id={`demo-saved-comparison-name-${index}`} tabIndex={-1}>{comparison.name}</h3>
                    <p>{count > 0 ? `${count} publications` : "Raccourci indisponible"}</p>
                  </div>
                  <div className="demo-card-actions">
                    <Button disabled={!enabled || readOnly || count === 0} id={`demo-saved-comparison-open-${index}`} onClick={() => onOpen(comparison, index)}>Ouvrir</Button>
                    <Button disabled={readOnly} id={`demo-saved-comparison-remove-${index}`} variant="secondary" onClick={() => onRemove(comparison, index)}>Supprimer</Button>
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
