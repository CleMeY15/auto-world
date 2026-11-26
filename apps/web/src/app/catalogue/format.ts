const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const distance = new Intl.NumberFormat("fr-FR", { style: "unit", unit: "kilometer" });
export function formatPrice(amount: number | null) {
  return amount === null ? "Prix non renseigné" : euro.format(amount / 100);
}
export function formatKm(km: number) {
  return distance.format(km);
}
export function formatDate(timestamp: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(timestamp));
}
