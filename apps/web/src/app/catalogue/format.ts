import type { Publication } from "../../catalogue/reader";

const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const distance = new Intl.NumberFormat("fr-FR", { style: "unit", unit: "kilometer" });
export function formatPrice({ price, dateKind }: Pick<Publication, "price" | "dateKind">) {
  if (price !== null) return euro.format(price / 100);
  return dateKind === "file_export" ? "Prix à confirmer" : "Prix non renseigné";
}
export function formatKm(km: number) {
  return distance.format(km);
}
export function formatDate(timestamp: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(timestamp));
}
