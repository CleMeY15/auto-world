"use client";

import { createContext, useContext, useId, useState, useSyncExternalStore, type ReactNode } from "react";
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

type Snapshot = { collection: Collection | null; message: string };
const initial: Snapshot = { collection: null, message: "" };

function createStore(scope: string | null) {
  const key = favoritesPrefix + scope;
  const listeners = new Set<() => void>();
  let snapshot = initial;
  function publish(collection: Collection, message = "") {
    snapshot = { collection, message };
    for (const listener of listeners) listener();
  }
  function subscribe(listener: () => void) {
    listeners.add(listener);
    if (scope && !snapshot.collection) {
      try {
        for (const old of Object.keys(sessionStorage)) {
          if (old.startsWith(favoritesPrefix) && old !== key) sessionStorage.removeItem(old);
        }
        publish(read(key));
      } catch { publish({ ids: [], error: unreadable }); }
    }
    return () => { listeners.delete(listener); };
  }
  function toggle(id: string) {
    if (!scope) return "Favoris indisponibles pour cette session.";
    const current = read(key);
    if (current.error) { publish(current); return current.error; }
    const saved = current.ids.includes(id);
    if (!saved && current.ids.length >= maxFavorites) {
      const error = "Limite de 12 favoris atteinte. Retirez une annonce pour continuer.";
      publish(current, error);
      return error;
    }
    const ids = saved ? current.ids.filter(value => value !== id) : [...current.ids, id];
    try {
      sessionStorage.setItem(key, JSON.stringify(ids));
    } catch {
      const error = "Modification impossible. Vérifiez le stockage de cet onglet puis réessayez.";
      publish(current, error);
      return error;
    }
    publish({ ids }, saved ? "Annonce retirée des favoris." : "Annonce ajoutée aux favoris.");
    return null;
  }
  return { scope, subscribe, toggle, getSnapshot: () => snapshot };
}

const Context = createContext<ReturnType<typeof createStore> | null>(null);

export function FavoriteProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  const [store] = useState(() => createStore(scope));
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useFavorites() {
  const store = useContext(Context);
  if (!store) throw new Error("missing_favorite_provider");
  // Each streamed boundary hydrates against the same empty server snapshot.
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initial);
  return { ...snapshot, scope: store.scope, toggle: store.toggle };
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
