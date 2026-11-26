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
  return <>{back}<h1>{item.label}</h1>
    <p className="catalogue-detail-price">{formatPrice(item)}</p>
    {item.photos.length > 0 && <PhotoGallery label={item.label} photos={item.photos} />}
    <dl className="catalogue-facts">
      <dt>Année</dt><dd>{item.year ?? "Non renseignée"}</dd>
      <dt>Kilométrage</dt><dd>{item.km !== null ? formatKm(item.km) : "Non renseigné"}</dd>
      <dt>Photos référencées</dt><dd>{item.photos.length}</dd>
      <dt>{item.dateKind === "file_export" ? "Exportée le" : "Annonce observée le"}</dt>
      <dd><time dateTime={item.observedAt}>{formatDate(item.observedAt)}</time></dd>
    </dl>
    {item.photos.length > 0 && <details className="catalogue-photos">
      <summary>Liens vers les photos ({item.photos.length})</summary>
      <ol aria-label="Photos de l’annonce Leboncoin">{item.photos.map((url, index) =>
        <li key={url}><a className="site-nav" href={url} referrerPolicy="no-referrer" rel="external noreferrer">Photo {index + 1}</a></li>
      )}</ol>
    </details>}
    <a className="aw-button" href={item.sourceUrl} referrerPolicy="no-referrer" rel="external noreferrer">Voir l’annonce sur Leboncoin</a>
  </>;
}
