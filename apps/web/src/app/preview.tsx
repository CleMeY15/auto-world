"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Banner, BookmarkIcon, Button, Card, Chip, Field, FilterIcon, Skeleton } from "@auto-world/design-system/primitives";

type PreviewState = "empty" | "loading" | "error" | "success";
type Theme = "system" | "light" | "dark";

export function FoundationPreview() {
  const [theme, setTheme] = useState<Theme>("system");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string>();
  const [applied, setApplied] = useState(false);
  const [selected, setSelected] = useState(false);
  const [state, setState] = useState<PreviewState>("empty");
  const focusNextAction = useRef(false);

  useLayoutEffect(() => {
    if (focusNextAction.current) {
      focusNextAction.current = false;
      document.getElementById("state-action")?.focus();
    }
  }, [state]);

  function advancePreview(next: PreviewState) {
    focusNextAction.current = true;
    setState(next);
  }

  function changeTheme(value: Theme) {
    setTheme(value);
    if (value === "system") delete document.documentElement.dataset.awTheme;
    else document.documentElement.dataset.awTheme = value;
  }

  function validateExample(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = budget.trim();
    const number = Number(value.replace(",", "."));
    if (!/^\d+(?:[.,]\d{1,2})?$/u.test(value) || !Number.isFinite(number) || number <= 0) {
      setError("Saisissez un montant supérieur à zéro.");
      setApplied(false);
      document.getElementById("budget")?.focus();
      return;
    }
    setError(undefined);
    setApplied(true);
  }

  function reset() {
    setBudget(""); setError(undefined); setApplied(false); setSelected(false);
    document.getElementById("budget")?.focus();
  }

  return (
    <>
      <div className="site-toolbar">
        <p>Un aperçu à essayer</p>
        <label className="site-select-label" htmlFor="theme">Apparence
          <select className="site-select" id="theme" value={theme} onChange={(event) => changeTheme(event.target.value as Theme)}>
            <option value="system">Automatique</option><option value="light">Clair</option><option value="dark">Sombre</option>
          </select>
        </label>
      </div>
      <div className="site-grid">
        <section aria-labelledby="controls-title" className="site-section">
          <h2 id="controls-title">Des critères faciles à ajuster</h2>
          <form onSubmit={validateExample} noValidate>
            <Field id="budget" label="Budget maximum (€)" inputMode="decimal" autoComplete="off" maxLength={16} value={budget} onChange={(event) => { setBudget(event.target.value); setError(undefined); setApplied(false); }} hint="Exemple de saisie. Aucun montant n’est enregistré." error={error} />
            <div className="site-chip-row"><Chip pressed={selected} onClick={() => setSelected(!selected)}><FilterIcon />Critère sélectionnable</Chip></div>
            <div className="site-actions"><Button type="submit">Valider l’exemple</Button><Button variant="secondary" onClick={reset}>Réinitialiser</Button></div>
            <div className="site-form-feedback">{applied ? <Banner tone="success">Le montant est valide. L’exemple est prêt.</Banner> : null}</div>
          </form>
          <div className="site-disabled-example">
            <Button disabled aria-describedby="search-unavailable">Rechercher</Button>
            <p id="search-unavailable">La recherche sera disponible avec les prochaines données de démonstration.</p>
          </div>
        </section>
        <section aria-labelledby="card-title" className="site-section">
          <h2 id="card-title">Une carte, l’essentiel d’abord</h2>
          <Card className="site-example-card">
            <BookmarkIcon />
            <h3>Un contenu lisible</h3>
            <p>Un titre, les informations utiles, puis les détails. Chaque élément garde sa place.</p>
            <div className="site-card-note">Exemple de carte sans données de véhicule.</div>
          </Card>
          <p className="site-caption">Les couleurs suivent votre préférence d’apparence. Le clavier et le toucher sont pris en compte dès les premiers composants.</p>
        </section>
      </div>
      <section id="states" aria-labelledby="states-title" className="site-states">
        <div className="site-states-heading"><div><h2 id="states-title">Une réponse pour chaque état</h2><p>Essayez le chargement, l’erreur ou la confirmation.</p></div>
          <label className="site-select-label" htmlFor="state">État de l’aperçu
            <select className="site-select" id="state" value={state} onChange={(event) => setState(event.target.value as PreviewState)}>
              <option value="empty">Vide</option><option value="loading">Chargement</option><option value="error">Erreur</option><option value="success">Confirmation</option>
            </select>
          </label>
        </div>
        <Card className="site-state-card" aria-busy={state === "loading" || undefined}>
          {state === "loading" ? <><p role="status">Chargement de l’aperçu…</p><div className="site-skeleton-lines"><Skeleton className="site-skeleton-title" /><Skeleton /><Skeleton className="site-skeleton-short" /></div><Button loading>Préparation de l’aperçu</Button></> : null}
          {state === "empty" ? <><h3>Aucun contenu pour le moment</h3><p>Vous pouvez afficher un exemple pour découvrir la confirmation.</p><Button id="state-action" onClick={() => advancePreview("success")}>Afficher un exemple</Button></> : null}
          {state === "error" ? <><Banner tone="danger">Le chargement de l’aperçu a échoué.</Banner><p>Une action claire permet de reprendre.</p><Button id="state-action" onClick={() => advancePreview("success")}>Réessayer</Button></> : null}
          {state === "success" ? <><Banner tone="success">L’aperçu est prêt.</Banner><p>La confirmation reste lisible et l’action peut être annulée.</p><Button id="state-action" variant="secondary" onClick={() => advancePreview("empty")}>Effacer l’exemple</Button></> : null}
        </Card>
      </section>
    </>
  );
}
