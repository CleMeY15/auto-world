"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { BookmarkIcon, Button } from "@auto-world/design-system";
import { favoriteIds, favoritesPrefix, maxFavorites } from "../../catalogue/favorites";

type Collection = { ids: string[]; error?: string };
const unreadable = "Impossible de lire les favoris de cet onglet.";
function read(key: string): Collection {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return { ids: [] };
    if (raw.length <= 320) {
      const ids: unknown = JSON.parse(raw);
      if (favoriteIds(ids)) return { ids };
    }
  } catch { /* A denied storage area and an unreadable value both stay untouched. */ }
  return { ids: [], error: unreadable };
}

const Context = createContext<{
  scope: string | null; collection: Collection | null; message: string;
  toggle: (id: string) => string | null;
} | null>(null);

export function FavoriteProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [message, setMessage] = useState("");
  const key = favoritesPrefix + scope;
  useEffect(() => {
    if (!scope) return;
    // Read browser-only state after hydration, never from a public document.
    function load() {
      try {
        for (const old of Object.keys(sessionStorage)) {
          if (old.startsWith(favoritesPrefix) && old !== key) sessionStorage.removeItem(old);
        }
        setCollection(read(key));
      } catch { setCollection({ ids: [], error: unreadable }); }
    }
    load();
  }, [scope, key]);
  function toggle(id: string) {
    if (!scope) return "Favoris indisponibles pour cette session.";
    const current = read(key);
    if (current.error) { setCollection(current); return current.error; }
    const saved = current.ids.includes(id);
    if (!saved && current.ids.length >= maxFavorites) {
      const error = "Limite de 12 favoris atteinte. Retirez une annonce pour continuer.";
      setMessage(error);
      return error;
    }
    const ids = saved ? current.ids.filter(value => value !== id) : [...current.ids, id];
    try {
      sessionStorage.setItem(key, JSON.stringify(ids));
    } catch {
      const error = "Modification impossible. Vérifiez le stockage de cet onglet puis réessayez.";
      setMessage(error);
      return error;
    }
    setCollection({ ids });
    setMessage(saved ? "Annonce retirée des favoris." : "Annonce ajoutée aux favoris.");
    return null;
  }
  return <Context.Provider value={{ scope, collection, message, toggle }}>{children}</Context.Provider>;
}
export function useFavorites() {
  const context = useContext(Context);
  if (!context) throw new Error("missing_favorite_provider");
  return context;
}
export function FavoriteButton({ id, label }: { id: string; label: string }) {
  const { collection, scope, toggle } = useFavorites();
  const saved = Boolean(collection?.ids.includes(id));
  const [error, setError] = useState<string | null>(null);
  const hint = useId();
  return <div className="catalogue-favorite-control"><Button variant="secondary" className="catalogue-favorite" aria-label={`Favori · ${label}`}
    disabled={!scope || !collection || Boolean(collection.error)} aria-pressed={saved} aria-describedby={error ? hint : undefined} onClick={() => setError(toggle(id))}>
    <BookmarkIcon />Favori
  </Button>{error && <p id={hint}>{error}</p>}</div>;
}
export function FavoriteNotice() {
  const { message, collection, scope } = useFavorites();
  return <div role="status" className="catalogue-favorite-notice">{!scope ? "Favoris indisponibles pour cette session."
    : collection?.error || message}</div>;
}
