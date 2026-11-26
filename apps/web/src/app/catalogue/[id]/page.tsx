import { privateCatalogEnabled } from "../../../catalogue/mode";
import { notFound } from "next/navigation";
import { Banner, ChevronLeftIcon } from "@auto-world/design-system";
import { fetchDetail, isListingId, pageWindow, windowPath } from "../../../catalogue/reader";
import { formatDate, formatKm, formatPrice } from "../format";
import { PhotoGallery } from "./photo-gallery";

export default async function PublicationPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!privateCatalogEnabled()) notFound();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const window = pageWindow(query);
  if (!isListingId(id) || !window) notFound();
  const back = <a className="site-nav catalogue-back" href={windowPath(window)}><ChevronLeftIcon />Retour aux annonces</a>;
  let item: Awaited<ReturnType<typeof fetchDetail>>;
  try { item = await fetchDetail(id); } catch {
    return <>{back}<h1>Annonce indisponible</h1><Banner tone="warning">
      <p>La fiche ne peut pas être chargée pour le moment.</p><a className="site-nav" href={windowPath(window, id)}>Réessayer</a>
    </Banner></>;
  }
  if (!item) notFound();
  return <>{back}
    <article className="catalogue-publication">
      <header className="catalogue-detail-heading">
        <h1>{item.label}</h1>
        <p>Annonce Leboncoin <span>·</span> N° {item.id}</p>
      </header>
      <div className="catalogue-detail-grid">
        <div className="catalogue-detail-media">
          {item.photos.length > 0
            ? <PhotoGallery label={item.label} photos={item.photos} />
            : <div className="catalogue-without-photo">Aucune photo disponible</div>}
        </div>
        <section className="catalogue-detail-summary" aria-labelledby="catalogue-price-label">
          <h2 id="catalogue-price-label">Prix de vente</h2>
          <p className={item.price === null ? "catalogue-detail-price catalogue-price-unknown" : "catalogue-detail-price"}>{formatPrice(item)}</p>
          <dl className="catalogue-facts">
            <div><dt>Année</dt><dd>{item.year ?? "Non renseignée"}</dd></div>
            <div><dt>Kilométrage</dt><dd>{item.km !== null ? formatKm(item.km) : "Non renseigné"}</dd></div>
            <div><dt>{item.dateKind === "file_export" ? "Exportée le" : "Observée le"}</dt>
              <dd><time dateTime={item.observedAt}>{formatDate(item.observedAt)}</time></dd></div>
          </dl>
          <a className="aw-button catalogue-source-link" href={item.sourceUrl}
            referrerPolicy="no-referrer" rel="external noreferrer">Voir l’annonce sur Leboncoin</a>
        </section>
      </div>
      {item.photos.length > 0 && <details className="catalogue-photos">
        <summary>Liens vers les photos ({item.photos.length})</summary>
        <ol aria-label="Photos de l’annonce Leboncoin">{item.photos.map((url, index) =>
          <li key={url}><a className="site-nav" href={url} referrerPolicy="no-referrer" rel="external noreferrer">Photo {index + 1}</a></li>
        )}</ol>
      </details>}
    </article>
  </>;
}
