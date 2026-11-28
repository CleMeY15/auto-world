import { notFound } from "next/navigation";
import { pageWindow, windowPath } from "../../../catalogue/reader";
import { SavedCollection } from "./collection";

export default async function FavoritesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const criteria = pageWindow(await searchParams);
  if (!criteria) notFound();
  const back = windowPath(criteria);
  return <SavedCollection query={back.split("?")[1] ?? ""} back={back} />;
}
