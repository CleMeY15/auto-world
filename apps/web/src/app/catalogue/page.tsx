import { privateCatalogEnabled } from "../../catalogue/mode";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Banner, Button, Field, Skeleton } from "@auto-world/design-system";
import { fetchList, maxQueryLength, pageWindow, windowPath, type PageWindow } from "../../catalogue/reader";
import { formatKm, formatPrice } from "./format";

async function Publications({ window }: { window: PageWindow }) {
  let page: Awaited<ReturnType<typeof fetchList>>;
  try { page = await fetchList(window); } catch {
    return <Banner tone="warning"><p>Le catalogue est momentanément indisponible.</p><a className="site-nav" href={windowPath(window)}>Réessayer</a></Banner>;
  }
  if (page.items.length === 0) {
    let message = "Aucune annonce disponible";
    if (window.after) message = "Fin des résultats";
    else if (window.q) message = "Aucune annonce pour cette recherche";
    return <section data-catalog-dataset={page.dataset}>
      <h2>{message}</h2>
      {window.after && <a className="site-nav" href={windowPath({ ...window, after: undefined })}>Revenir aux premières annonces</a>}
      {!window.after && !window.q && <a className="site-nav" href={windowPath(window)}>Actualiser le catalogue</a>}
    </section>;
  }
  return <>
    <ul data-catalog-dataset={page.dataset} aria-label="Annonces Leboncoin" className="catalogue-list">{page.items.map(item => <li key={item.id}>
      <a className="catalogue-row" href={windowPath(window, item.id)}>
        <span><strong>{item.label}</strong><span className="catalogue-meta">{[item.year, item.km !== null ? formatKm(item.km) : null].filter(v => v !== null).join(" · ")}</span></span>
        <span className="catalogue-price">{formatPrice(item.price)}</span>
      </a>
    </li>)}</ul>
    <nav aria-label="Pagination" className="catalogue-pages">
      {window.after && <a className="site-nav" href={windowPath({ ...window, after: undefined })}>Premières annonces</a>}
      {page.next && <a className="aw-button" href={windowPath({ ...window, after: page.next })}>Page suivante</a>}
    </nav>
  </>;
}
export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!privateCatalogEnabled()) notFound();
  const window = pageWindow(await searchParams);
  if (!window) notFound();
  return <>
    <h1>Annonces automobiles</h1>
    <p className="catalogue-muted">Source des annonces · Leboncoin</p>
    <form action="/catalogue" method="get" role="search" aria-label="Rechercher une annonce" className="catalogue-search">
      <Field id="catalogue-recherche" name="q" type="search" label="Marque, modèle, année ou numéro d’annonce"
        defaultValue={window.q ?? ""} maxLength={maxQueryLength} />
      {window.limit !== 20 && <input type="hidden" name="limit" value={window.limit} />}
      <Button type="submit">Rechercher</Button>
    </form>
    {window.q && <a className="site-nav" href={windowPath({ limit: window.limit })}>Effacer la recherche</a>}
    <Suspense fallback={<div role="status"><span>Chargement des annonces…</span><Skeleton className="catalogue-skeleton" /></div>}>
      <Publications window={window} />
    </Suspense>
  </>;
}
