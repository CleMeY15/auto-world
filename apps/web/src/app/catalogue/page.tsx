import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Banner, Button, CloseIcon, SearchIcon, Skeleton } from "@auto-world/design-system";
import { privateCatalogEnabled } from "../../catalogue/mode";
import { fetchList, maxQueryLength, pageWindow, windowPath, type PageWindow } from "../../catalogue/reader";
import { formatKm, formatPrice } from "./format";
import { ListingCard } from "./list-photos";
import { FilterPanel, SortResults } from "./filters";

const integer = new Intl.NumberFormat("fr-FR");

function activeCriteria(window: PageWindow) {
  return ([
    ["brand", window.brand],
    ["model", window.model],
    ["fuel", window.fuel],
    ["gearbox", window.gearbox && "Boîte " + window.gearbox.toLocaleLowerCase("fr")],
    ["body", window.body],
    ["color", window.color && "Couleur · " + window.color],
    ["upholstery", window.upholstery && "Sellerie · " + window.upholstery],
    ["doors", window.doors && window.doors + (window.doors === 1 ? " porte" : " portes")],
    ["seatsMin", window.seatsMin && "Places min. · " + window.seatsMin],
    ["seatsMax", window.seatsMax && "Places max. · " + window.seatsMax],
    ["firstOwner", window.firstOwner && "Première main"],
    ["inspectionValid", window.inspectionValid && "Contrôle technique valide"],
    ["serviceBook", window.serviceBook && "Carnet d’entretien"],
    ["hasPhotos", window.hasPhotos && "Avec photos"],
    ["hasPrice", window.hasPrice && "Prix de vente renseigné"],
    ["priceMin", window.priceMin !== undefined && "Dès " + integer.format(window.priceMin) + " €"],
    ["priceMax", window.priceMax !== undefined && "Jusqu’à " + integer.format(window.priceMax) + " €"],
    ["yearMin", window.yearMin !== undefined && "À partir de " + window.yearMin],
    ["yearMax", window.yearMax !== undefined && "Jusqu’en " + window.yearMax],
    ["kmMin", window.kmMin !== undefined && formatKm(window.kmMin) + " min."],
    ["kmMax", window.kmMax !== undefined && formatKm(window.kmMax) + " max."],
  ] as const).flatMap(([key, label]) => label ? [{ key, label }] : []);
}

async function Publications({ window }: { window: PageWindow }) {
  let page: Awaited<ReturnType<typeof fetchList>>;
  try { page = await fetchList(window); } catch {
    return <Banner tone="warning"><p>Le catalogue est momentanément indisponible.</p><a className="site-nav" href={windowPath(window)}>Réessayer</a></Banner>;
  }
  const active = activeCriteria(window);
  const noFilters = windowPath({ q: window.q, limit: window.limit, sort: window.sort });
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
        {window.sort && <input type="hidden" name="sort" value={window.sort} />}
        {window.limit !== 20 && <input type="hidden" name="limit" value={window.limit} />}
        {active.map(({ key }) => <input key={key} type="hidden" name={key} value={window[key]} />)}
        <Button type="submit">Rechercher</Button>
      </form>
      <FilterPanel criteria={window} brands={page.brands} modelsByBrand={page.modelsByBrand}
        filterOptions={page.filterOptions} active={active.length} />
    </div>
    {filtered && <nav className="catalogue-applied" aria-label="Critères appliqués">
      {window.q && <a href={windowPath({ ...window, q: undefined, after: undefined })} aria-label="Effacer la recherche">
        « {window.q} » <CloseIcon />
      </a>}
      {active.map(({key,label}) => <a key={key} aria-label={"Retirer le filtre " + label}
        href={windowPath({ ...window, [key]: undefined, ...(key === "brand" ? { model: undefined } : {}), after: undefined })}>{label}<CloseIcon /></a>)}
      {active.length > 0 && <a className="catalogue-clear" href={noFilters}>Effacer les filtres</a>}
    </nav>}
    {page.items.length > 0 ? <>
      <div className="catalogue-list-heading">
        <h2>{filtered ? "Résultats de recherche" : "Toutes les annonces"}</h2>
        <span>{page.items.length} {page.items.length === 1 ? "annonce affichée" : "annonces affichées"}</span>
        <SortResults criteria={window} />
      </div>
      <ul id="catalogue-results" data-catalog-dataset={page.dataset} aria-label="Annonces Leboncoin" className="catalogue-list">{page.items.map(item => <li key={item.id}>
        <ListingCard href={windowPath(window, item.id)} photos={item.photos} label={item.label}>
          <span className="catalogue-card-copy">
            <strong>{item.label}</strong>
            <span className="catalogue-meta">{[item.year, item.km !== null ? formatKm(item.km) : null, item.features.fuel, item.features.gearbox].filter(v => v != null).join(" · ")}</span>
            <span className="catalogue-card-bottom">
              <span className={item.price === null ? "catalogue-price catalogue-price-unknown" : "catalogue-price"}>{formatPrice(item)}</span>
              <span aria-hidden="true">↗</span>
            </span>
          </span>
        </ListingCard>
      </li>)}</ul>
      <nav aria-label="Pagination" className="catalogue-pages">
        {window.after && <a className="site-nav" href={windowPath({ ...window, after: undefined })}>Premières annonces</a>}
        {page.next && <a className="aw-button aw-button--secondary" href={windowPath({ ...window, after: page.next })}>Page suivante</a>}
      </nav>
    </> : <section className="catalogue-empty" data-catalog-dataset={page.dataset}>
      <h2>{window.after ? "Fin des résultats" : filtered ? "Aucune annonce pour cette recherche" : "Aucune annonce disponible"}</h2>
      {window.after ? <a className="site-nav" href={windowPath({ ...window, after: undefined })}>Revenir aux premières annonces</a>
        : filtered ? <a className="site-nav" href={windowPath({ limit: window.limit, sort: window.sort })}>Voir toutes les annonces</a>
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
