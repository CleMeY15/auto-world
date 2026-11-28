"use client";

import { useEffect, useRef, useState } from "react";
import { Banner, Button, Skeleton } from "@auto-world/design-system";
import type { FavoriteRow } from "../../../catalogue/favorites";
import { FavoriteNotice, useFavorites } from "../favorites";

function Loading() {
  return <div role="status"><p>Chargement des favoris…</p><Skeleton className="catalogue-loading-tools" /></div>;
}

function Entries({ ids, scope, query, onRemove }: {
  ids: string[]; scope: string; query: string; onRemove: (id: string) => void;
}) {
  const [rows, setRows] = useState<FavoriteRow[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sessionChanged, setSessionChanged] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await fetch("/catalogue/favoris/lecture", {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
          body: JSON.stringify({ scope, ids }), signal: controller.signal,
        });
        if (result.status === 401 || result.status === 403) {
          if (!controller.signal.aborted) setSessionChanged(true);
          return;
        }
        if (!result.ok) throw new Error("lookup_failed");
        const items: FavoriteRow[] = await result.json();
        if (!Array.isArray(items) || items.length !== ids.length) throw new Error("lookup_failed");
        if (!controller.signal.aborted) setRows(items);
      } catch {
        if (!controller.signal.aborted) setRows(ids.map(() => ({ status: "failed" })));
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, ids, scope]);
  if (sessionChanged) return <Banner tone="warning"><p>Votre session a changé. Rouvrez vos favoris pour continuer.</p>
    <a className="site-nav" href={"/catalogue/favoris" + (query ? "?" + query : "")}>Rouvrir les favoris</a></Banner>;
  if (!rows) return <Loading />;
  const failed = rows.some(row => row.status === "failed");
  return <>
    {failed && <Banner tone="warning"><p>{rows.every(row => row.status === "failed")
      ? "Vos favoris ne peuvent pas être chargés." : "Certains favoris ne peuvent pas être chargés."} Vérifiez votre connexion ou reconnectez-vous.</p>
      <Button variant="secondary" onClick={() => { setRows(null); setAttempt(value => value + 1); }}>Réessayer</Button></Banner>}
    <ul className="catalogue-saved-list" aria-label="Favoris">{rows.map((row, index) => {
      const id = ids[index]!;
      const title = row.status === "available" ? row.label : row.status === "missing" ? "Annonce indisponible" : "Chargement impossible";
      return <li key={id}><div>{row.status === "available"
        ? <><a className="site-nav" href={`/catalogue/${id}?${query ? query + "&" : ""}depuis=favoris`}>{title}</a>
          <p>{[row.year, row.price].filter(Boolean).join(" · ")}</p></>
        : <strong>{title}</strong>}</div>
        <Button variant="secondary" onClick={() => onRemove(id)} aria-label={`Retirer des favoris · ${title}`}>Retirer</Button></li>;
    })}</ul>
  </>;
}

export function SavedCollection({ query, back }: { query: string; back: string }) {
  const { scope, collection, toggle } = useFavorites();
  const heading = useRef<HTMLHeadingElement>(null);
  return <>
    <header className="catalogue-intro"><h1 tabIndex={-1} ref={heading}>Favoris</h1>
      <p>Jusqu’à 12 annonces, conservées dans cet onglet pendant votre session.</p></header>
    <FavoriteNotice />
    {scope && (!collection ? <Loading /> : !collection.error && (collection.ids.length
      ? <Entries key={collection.ids.join(",")} ids={collection.ids} scope={scope} query={query}
        onRemove={id => { if (toggle(id) === null) heading.current?.focus(); }} />
      : <section className="catalogue-empty"><h2>Aucun favori</h2><p>Enregistrez une annonce depuis les résultats ou sa fiche.</p></section>))}
    <a className="site-nav catalogue-back" href={back}>Retour aux annonces</a>
  </>;
}
