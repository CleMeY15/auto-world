import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Banner, Button, CloseIcon, SearchIcon, Skeleton } from "@auto-world/design-system";
import { privateCatalogEnabled } from "../../catalogue/mode";
import { fetchList, maxQueryLength, pageWindow, windowPath, type PageWindow } from "../../catalogue/reader";
import { formatKm, formatPrice } from "./format";
import { ListingThumbnail } from "./list-photos";
import { FilterPanel } from "./filters";

const integer = new Intl.NumberFormat("fr-FR");

function activeCriteria(window: PageWindow) {
  return ([
    ["brand", window.brand],
    ["hasPrice", window.hasPrice && "Prix de vente renseigné"],
    ["priceMin", window.priceMin !== undefined && "Dès " + integer.format(window.priceMin) + " €"],
    ["priceMax", window.priceMax !== undefined && "Jusqu’à " + integer.format(window.priceMax) + " €"],
    ["yearMin", window.yearMin !== undefined && "À partir de " + window.yearMin],
    ["yearMax", window.yearMax !== undefined && "Jusqu’en " + window.yearMax],
    ["kmMax", window.kmMax !== undefined && formatKm(window.kmMax) + " max."],
  ] as const).flatMap(([key, label]) => label ? [{ key, label }] : []);
}

async function Publications({ window }: { window: PageWindow }) {
  let page: Awaited<ReturnType<typeof fetchList>>;
  try { page = await fetchList(window); } catch {
    return <Banner tone="warning"><p>Le catalogue est momentanément indisponible.</p><a className="site-nav" href={windowPath(window)}>Réessayer</a></Banner>;
  }
  const active = activeCriteria(window);
  const noFilters = windowPath({ q: window.q, limit: window.limit });
  const filtered = Boolean(window.q || active.length);
  return <>
    <div className="catalogue-tools">
      <form action="/catalogue" method="get" role="search" aria-label="Rechercher une annonce" className="catalogue-search">
        <div className="catalogue-query">
          <SearchIcon />
          <label className="catalogue-sr-only" htmlFor="catalogue-recherche">Marque, modèle, année ou numéro d’annonce</label>
          <input id="catalogue-recherche" name="q" type="search" placeholder="Marque, modèle, année…"
            defaultValue={window.q ?? ""} maxLength={maxQueryLength} />
        </div>
        {window.limit !== 20 && <input type="hidden" name="limit" value={window.limit} />}
        {active.map(({ key }) => <input key={key} type="hidden" name={key} value={window[key]} />)}
        <Button type="submit">Rechercher</Button>
      </form>
      <FilterPanel criteria={window} brands={page.brands} active={active.length} />
    </div>
    {filtered && <nav className="catalogue-applied" aria-label="Critères appliqués">
      {window.q && <a href={windowPath({ ...window, q: undefined, after: undefined })} aria-label="Effacer la recherche">
        « {window.q} » <CloseIcon />
      </a>}
      {active.map(({key,label}) => <a key={key} aria-label={"Retirer le filtre " + label}
        href={windowPath({ ...window, [key]: undefined, after: undefined })}>{label}<CloseIcon /></a>)}
      {active.length > 0 && <a className="catalogue-clear" href={noFilters}>Effacer les filtres</a>}
    </nav>}
    {page.items.length > 0 ? <>
      <div className="catalogue-list-heading">
        <h2>{filtered ? "Résultats de recherche" : "Toutes les annonces"}</h2>
        <span>{page.items.length} {page.items.length === 1 ? "annonce affichée" : "annonces affichées"}</span>
      </div>
      <ul id="catalogue-results" data-catalog-dataset={page.dataset} aria-label="Annonces Leboncoin" className="catalogue-list">{page.items.map(item => <li key={item.id}>
        <a className="catalogue-row" href={windowPath(window, item.id)}>
          <span className="catalogue-card-media">
            <ListingThumbnail src={item.photos[0]} />
            {item.photos.length > 1 && <span className="catalogue-photo-count">{item.photos.length} photos</span>}
          </span>
          <span className="catalogue-card-copy">
            <strong>{item.label}</strong>
            <span className="catalogue-meta">{[item.year, item.km !== null ? formatKm(item.km) : null].filter(v => v !== null).join(" · ")}</span>
            <span className="catalogue-card-bottom">
              <span className={item.price === null ? "catalogue-price catalogue-price-unknown" : "catalogue-price"}>{formatPrice(item)}</span>
              <span aria-hidden="true">↗</span>
            </span>
          </span>
        </a>
      </li>)}</ul>
      <nav aria-label="Pagination" className="catalogue-pages">
        {window.after && <a className="site-nav" href={windowPath({ ...window, after: undefined })}>Premières annonces</a>}
        {page.next && <a className="aw-button aw-button--secondary" href={windowPath({ ...window, after: page.next })}>Page suivante</a>}
      </nav>
    </> : <section className="catalogue-empty" data-catalog-dataset={page.dataset}>
      <h2>{window.after ? "Fin des résultats" : filtered ? "Aucune annonce pour cette recherche" : "Aucune annonce disponible"}</h2>
      {window.after ? <a className="site-nav" href={windowPath({ ...window, after: undefined })}>Revenir aux premières annonces</a>
        : filtered ? <a className="site-nav" href={windowPath({ limit: window.limit })}>Voir toutes les annonces</a>
        : <a className="site-nav" href={windowPath(window)}>Actualiser le catalogue</a>}
    </section>}
  </>;
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!privateCatalogEnabled()) notFound();
  const window = pageWindow(await searchParams);
  if (!window) notFound();
  return <>
    <header className="catalogue-intro">
      <h1>Annonces automobiles</h1>
      <p>Source des annonces · Leboncoin</p>
    </header>
    <Suspense fallback={<div role="status" className="catalogue-loading">
      <span className="catalogue-sr-only">Chargement des annonces…</span>
      <Skeleton className="catalogue-loading-tools" />
      <div className="catalogue-list" aria-hidden="true">
        <Skeleton className="catalogue-skeleton" /><Skeleton className="catalogue-skeleton" /><Skeleton className="catalogue-skeleton" />
      </div>
    </div>}>
      <Publications window={window} />
    </Suspense>
  </>;
}
