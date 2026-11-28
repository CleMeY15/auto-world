"use client";

import { createContext, useContext, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
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

type Snapshot = { collection: Collection | null; message: string; pending: boolean };
const initial: Snapshot = { collection: null, message: "", pending: false };

function createStore(scope: string | null) {
  const key = favoritesPrefix + scope;
  const listeners = new Set<() => void>();
  let snapshot = initial;
  let writing = false;
  let suspended = false;
  let visibilityEpoch = 0;
  function publish(collection: Collection, message = "") {
    snapshot = { collection, message, pending: writing };
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
  function suspend() {
    suspended = true;
    document.documentElement.style.visibility = "hidden";
  }
  async function sessionMatches() {
    const response = await fetch("/catalogue/favoris/lecture", {
      method: "POST", headers: { "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(8_000), body: JSON.stringify({ scope, ids: [] }),
    });
    if (response.status === 401 || response.status === 403 || response.redirected) return false;
    if (!response.ok) throw new Error("session_check_failed");
    const receipt: unknown = await response.json();
    if (!Array.isArray(receipt) || receipt.length !== 0) throw new Error("invalid_session_receipt");
    return true;
  }
  async function onVisibilityChange() {
    const epoch = ++visibilityEpoch;
    if (document.hidden) { suspend(); return; }
    if (!suspended) return;
    // Reopen the saved collection through the reader so admission is current.
    if (window.location.pathname === "/catalogue/favoris") { window.location.reload(); return; }
    try {
      if (scope && await sessionMatches()) {
        if (epoch === visibilityEpoch) {
          suspended = false;
          document.documentElement.style.visibility = "";
        }
        return;
      }
    } catch { /* A fresh navigation also handles an expired or unavailable session. */ }
    if (epoch === visibilityEpoch) window.location.reload();
  }
  async function toggle(id: string) {
    const unavailable = "Favoris indisponibles pour cette session.";
    if (!scope || suspended || document.hidden) return unavailable;
    if (writing || !snapshot.collection) return "Une modification est en cours.";
    const epoch = visibilityEpoch;
    writing = true;
    publish(snapshot.collection);
    try {
      if (!(await sessionMatches())) {
        suspend();
        window.location.reload();
        return unavailable;
      }
      if (suspended || document.hidden || epoch !== visibilityEpoch) return unavailable;
      return write(id);
    } catch {
      return "Modification impossible. Vérifiez votre connexion puis réessayez.";
    } finally {
      writing = false;
      if (snapshot.collection) publish(snapshot.collection, snapshot.message);
    }
  }
  function write(id: string) {
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
  return { scope, subscribe, toggle, onVisibilityChange, getSnapshot: () => snapshot };
}

const Context = createContext<ReturnType<typeof createStore> | null>(null);

export function FavoriteProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  const [store] = useState(() => createStore(scope));
  useEffect(() => {
    const handle = store.onVisibilityChange;
    document.addEventListener("visibilitychange", handle);
    handle();
    return () => document.removeEventListener("visibilitychange", handle);
  }, [store]);
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
  const { collection, scope, toggle, pending } = useFavorites();
  const saved = Boolean(collection?.ids.includes(id));
  const [error, setError] = useState<string | null>(null);
  const hint = useId();
  return <div className="catalogue-favorite-control"><Button variant="secondary" className="catalogue-favorite" aria-label={`Favori · ${label}`}
    aria-busy={pending} disabled={pending || !scope || !collection || Boolean(collection.error)} aria-pressed={saved} aria-describedby={error ? hint : undefined} onClick={async () => setError(await toggle(id))}>
    <BookmarkIcon />Favori
  </Button>{error && <p id={hint}>{error}</p>}</div>;
}
export function FavoriteNotice() {
  const { message, collection, scope } = useFavorites();
  return <div role="status" className="catalogue-favorite-notice">{!scope ? "Favoris indisponibles pour cette session."
    : collection?.error || message}</div>;
}
