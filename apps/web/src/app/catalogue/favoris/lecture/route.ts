import { favoriteIds, validScope, type FavoriteRow } from "../../../../catalogue/favorites";
import { privateCatalogEnabled } from "../../../../catalogue/mode";
import { fetchDetail } from "../../../../catalogue/reader";
import { formatPrice } from "../../format";

export async function POST(request: Request) {
  const scope = request.headers.get("x-aw-favorites-scope");
  if (!privateCatalogEnabled() || !validScope(scope)) return new Response(null, { status: 403 });
  // The edge caps request bodies at 16 KiB and only forwards same-origin POSTs.
  if (request.headers.get("content-type") !== "application/json") return new Response(null, { status: 415 });
  const body = await request.text();
  if (body.length > 512) return new Response(null, { status: 413 });
  let data;
  try { data = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
  if (data?.scope !== scope) return new Response(null, { status: 403 });
  if (!favoriteIds(data.ids)) return new Response(null, { status: 400 });
  const rows = await Promise.all(data.ids.map(async (id: string): Promise<FavoriteRow> => {
    try {
      const item = await fetchDetail(id);
      return item ? { status: "available", label: item.label, year: item.year, price: formatPrice(item) }
        : { status: "missing" };
    } catch { return { status: "failed" }; }
  }));
  return Response.json(rows, { headers: { "Cache-Control": "private, no-store" } });
}
