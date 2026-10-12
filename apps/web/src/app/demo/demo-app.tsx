"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Banner, Button, Card, Field, FilterIcon, SearchIcon } from "@auto-world/design-system/primitives";
import type { DemoResultV1, DemoSearchQueryV1, DemoSearchResponseV1, DemoSearchSort } from "@auto-world/demo-search-contract";

import { recordAnalyticsEvent, type DemoAnalyticsOutcome, type DemoAnalyticsScreen } from "../../demo/analytics";
import { createDemoClient, createSearchPagination, loadSavedDetails, type DemoClientErrorCode, type DemoClientOutcome } from "../../demo/client";
import { createFavoritesStore, type FavoritesStorageStatus } from "../../demo/favorites";
import { parseFilterInput } from "../../demo/model";
import { parsePublicListingId } from "../../demo/protocol";
import {
  EvidenceDetails,
  LoadingResults,
  NeutralIllustration,
  ResultCard,
  ResultSummary,
  ScreenHeader,
  StatePanel,
  SyntheticDisclosure,
} from "./demo-components";

type Screen = "search" | "results" | "detail" | "saved";
type ListingId = NonNullable<ReturnType<typeof parsePublicListingId>>;
type DetailState = { readonly status: "idle" | "loading" } | { readonly status: "ready"; readonly result: DemoResultV1 } | { readonly status: "error"; readonly code: DemoClientErrorCode };
type SearchError = DemoClientErrorCode | "changed_snapshot" | "changed_state" | "duplicate_result" | "inconsistent_page" | "projection_overflow" | "late_page";
type Theme = "system" | "light" | "dark";

const client = createDemoClient();

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
function getHashSnapshot() { return window.location.hash || "#search"; }
function getHashServerSnapshot() { return "#search"; }
function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener); window.addEventListener("offline", listener);
  return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
}
function getOnlineSnapshot() { return navigator.onLine; }
function getOnlineServerSnapshot() { return true; }

function parseLocation(hash: string): { readonly screen: Screen; readonly listingId?: ListingId; readonly invalid?: boolean } {
  if (hash === "#demo-main") return { screen: "search" };
  if (hash === "#saved") return { screen: "saved" };
  if (hash === "#results") return { screen: "results" };
  if (hash.startsWith("#detail/")) {
    let raw: string;
    try { raw = decodeURIComponent(hash.slice(8)); } catch { return { screen: "search", invalid: true }; }
    const parsed = parsePublicListingId(raw);
    return parsed === undefined ? { screen: "search", invalid: true } : { screen: "detail", listingId: parsed };
  }
  return { screen: "search", invalid: hash !== "" && hash !== "#search" };
}

function errorCopy(code: SearchError | undefined) {
  if (code === "offline") return "La connexion est indisponible. Vos critères restent ici pour réessayer.";
  if (code === "cancelled") return "La demande a pris trop de temps. Vous pouvez la relancer.";
  if (code === "projection_overflow") return "La projection dépasse la limite de démonstration. Affinez les critères puis recommencez.";
  if (code === "changed_snapshot" || code === "changed_state" || code === "duplicate_result" || code === "inconsistent_page" || code === "late_page") return "Les pages ne décrivent plus le même instant de démonstration. Relancez la recherche pour repartir d’un ensemble cohérent.";
  if (code) return "La lecture synthétique est momentanément indisponible. Vos critères n’ont pas été perdus.";
  return "";
}

function outcomeForResponse(response: DemoSearchResponseV1): DemoAnalyticsOutcome {
  if (response.results.length === 0) return "empty";
  return response.state === "complete" ? "success" : response.state;
}

function storageCopy(status: FavoritesStorageStatus) {
  if (status === "session") return "Les favoris restent disponibles dans cette session, mais ils ne sont pas enregistrés sur cet appareil.";
  if (status === "quota") return "L’enregistrement local est plein. Les changements restent limités à cette session.";
  if (status === "denied") return "Le stockage local est inaccessible. Les changements restent limités à cette session.";
  if (status === "corrupt") return "Les favoris enregistrés sont illisibles. Vous pouvez les réinitialiser explicitement.";
  if (status === "future") return "Ces favoris proviennent d’une version plus récente. Ils sont préservés et ne seront pas modifiés.";
  return undefined;
}

export function DemoApp({ enabled }: { readonly enabled: boolean }) {
  const hash = useSyncExternalStore(subscribeHash, getHashSnapshot, getHashServerSnapshot);
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot);
  const location = parseLocation(hash);
  const screen: Screen = enabled ? location.screen : "saved";
  const [favorites] = useState(() => createFavoritesStore());
  const [pagination] = useState(() => createSearchPagination());
  const favoriteSnapshot = useSyncExternalStore(favorites.subscribe, favorites.getSnapshot, favorites.getServerSnapshot);
  const [theme, setTheme] = useState<Theme>("system");
  const [text, setText] = useState("");
  const [price, setPrice] = useState("");
  const [mileage, setMileage] = useState("");
  const [sort, setSort] = useState<DemoSearchSort>("listing_asc");
  const [advanced, setAdvanced] = useState(false);
  const [fieldError, setFieldError] = useState<{ readonly field: "text" | "priceMaxEUR" | "mileageMaxKm" | "sort"; readonly message: string }>();
  const [response, setResponse] = useState<DemoSearchResponseV1>();
  const [searchError, setSearchError] = useState<SearchError>();
  const [pageFailure, setPageFailure] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [slow, setSlow] = useState(false);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [detailRetry, setDetailRetry] = useState(0);
  const [savedDetails, setSavedDetails] = useState<ReadonlyMap<ListingId, DemoClientOutcome>>(() => new Map());
  const [announcement, setAnnouncement] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const searchAbort = useRef<AbortController | undefined>(undefined);
  const detailAbort = useRef<AbortController | undefined>(undefined);
  const savedAbort = useRef<AbortController | undefined>(undefined);
  const searchEpoch = useRef(0);
  const detailEpoch = useRef(0);
  const savedEpoch = useRef(0);
  const lastQuery = useRef<DemoSearchQueryV1 | undefined>(undefined);
  const resultsScroll = useRef(0);
  const resultsReturnIndex = useRef<number | undefined>(undefined);
  const appendStartIndex = useRef(0);
  const removedFavoriteIndex = useRef<number | undefined>(undefined);
  const pendingResponseFocus = useRef<string | undefined>(undefined);
  const initialSearchFocus = useRef(true);
  const markHydrated = useCallback((node: HTMLElement | null) => { if (node) node.dataset.demoHydrated = "true"; }, []);

  const changeTheme = useCallback((value: Theme) => {
    setTheme(value);
    if (value === "system") delete document.documentElement.dataset.awTheme;
    else document.documentElement.dataset.awTheme = value;
  }, []);

  const navigate = useCallback((next: Screen, listingId?: ListingId) => {
    if (screen === "results" && next === "detail") resultsScroll.current = window.scrollY;
    const nextHash = next === "detail" && listingId ? `#detail/${encodeURIComponent(listingId)}` : `#${next}`;
    if (window.location.hash === nextHash) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else window.location.hash = nextHash;
  }, [screen]);

  useEffect(() => { favorites.hydrate(); }, [favorites]);
  useEffect(() => {
    const label = screen === "search" ? "Recherche" : screen === "results" ? "Résultats" : screen === "detail" ? "Détail synthétique" : "Favoris synthétiques";
    document.title = `${label} — Auto World`;
  }, [screen]);
  useEffect(() => {
    if (["session", "corrupt", "future", "denied", "quota"].includes(favoriteSnapshot.storageStatus)) {
      recordAnalyticsEvent({ eventName: "storage_failed", screen, outcome: "error" });
    }
  }, [favoriteSnapshot.storageStatus, screen]);
  useEffect(() => {
    const listener = (event: StorageEvent) => favorites.reconcileStorageEvent(event);
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [favorites]);

  useLayoutEffect(() => {
    if (initialSearchFocus.current && screen === "search") {
      initialSearchFocus.current = false;
      return;
    }
    initialSearchFocus.current = false;
    const heading = document.getElementById("demo-screen-title");
    if (screen === "results" && resultsReturnIndex.current !== undefined) {
      const trigger = document.getElementById(`demo-result-open-${resultsReturnIndex.current}`);
      trigger?.focus({ preventScroll: true });
      window.scrollTo({ top: resultsScroll.current });
      resultsReturnIndex.current = undefined;
    } else {
      heading?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
  }, [screen, location.listingId]);
  useLayoutEffect(() => {
    if (!response || pendingResponseFocus.current === undefined) return;
    document.getElementById(pendingResponseFocus.current)?.focus({ preventScroll: true });
    pendingResponseFocus.current = undefined;
  }, [response]);

  useEffect(() => {
    if (screen !== "detail" || !enabled || !location.listingId) return;
    const controller = new AbortController();
    detailAbort.current?.abort(); detailAbort.current = controller;
    const epoch = ++detailEpoch.current;
    queueMicrotask(() => { if (!controller.signal.aborted && epoch === detailEpoch.current) setDetail({ status: "loading" }); });
    void client.listing(location.listingId, { signal: controller.signal }).then((outcome) => {
      if (controller.signal.aborted || epoch !== detailEpoch.current) return;
      if (outcome.ok && outcome.data.results[0]) setDetail({ status: "ready", result: outcome.data.results[0] });
      else setDetail({ status: "error", code: outcome.ok ? "invalid_response" : outcome.code });
    });
    return () => controller.abort();
  }, [detailRetry, enabled, location.listingId, screen]);

  const savedIdsKey = favoriteSnapshot.listingIds.join("|");
  useEffect(() => {
    if (screen !== "saved" || !enabled || !online || favoriteSnapshot.listingIds.length === 0) {
      savedAbort.current?.abort();
      queueMicrotask(() => setSavedDetails(new Map()));
      return;
    }
    const controller = new AbortController();
    savedAbort.current?.abort(); savedAbort.current = controller;
    const epoch = ++savedEpoch.current;
    queueMicrotask(() => { if (!controller.signal.aborted && epoch === savedEpoch.current) setSavedDetails(new Map()); });
    void loadSavedDetails(client, favoriteSnapshot.listingIds, {
      signal: controller.signal,
      onItem(item) {
        if (controller.signal.aborted || epoch !== savedEpoch.current) return;
        setSavedDetails((current) => { const next = new Map(current); next.set(item.listingId, item.outcome); return next; });
      },
    });
    return () => controller.abort();
  }, [enabled, favoriteSnapshot.listingIds, online, savedIdsKey, screen]);

  useEffect(() => () => { searchAbort.current?.abort(); detailAbort.current?.abort(); savedAbort.current?.abort(); }, []);

  const focusAfterRender = useCallback((id: string) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById(id)?.focus()));
  }, []);

  const runSearch = useCallback(async (query: DemoSearchQueryV1, append: boolean, focusAfter?: "refresh") => {
    const pageToken = append ? pagination.beginNext() : pagination.beginSearch();
    if (pageToken === undefined) return;
    const requestedQuery: DemoSearchQueryV1 = {
      schemaVersion: query.schemaVersion,
      sort: query.sort,
      ...(query.priceMaxMinor === undefined ? {} : { priceMaxMinor: query.priceMaxMinor }),
      ...(query.mileageMaxKm === undefined ? {} : { mileageMaxKm: query.mileageMaxKm }),
      ...(pageToken.cursor === undefined ? {} : { cursor: pageToken.cursor }),
    };
    const controller = new AbortController();
    searchAbort.current?.abort(); searchAbort.current = controller;
    const epoch = ++searchEpoch.current;
    if (append) setLoadingMore(true); else setLoading(true);
    setSearchError(undefined); setPageFailure(false); setSlow(false);
    const slowTimer = window.setTimeout(() => { if (!controller.signal.aborted && epoch === searchEpoch.current) setSlow(true); }, 750);
    const outcome = await client.search(requestedQuery, { signal: controller.signal });
    window.clearTimeout(slowTimer);
    if (controller.signal.aborted || epoch !== searchEpoch.current) return;
    setSlow(false); if (append) setLoadingMore(false); else setLoading(false);
    if (!outcome.ok) { setPageFailure(append); setSearchError(outcome.code); if (append) focusAfterRender("demo-page-retry"); return; }
    const accepted = append ? pagination.acceptNext(pageToken, outcome.data) : pagination.acceptFirst(pageToken, outcome.data);
    if (!accepted.ok) { setPageFailure(append); setSearchError(accepted.code); if (append) focusAfterRender("demo-page-retry"); return; }
    const next = accepted.data;
    if (append) pendingResponseFocus.current = next.nextCursor ? "demo-load-more" : `demo-result-open-${appendStartIndex.current}`;
    else if (focusAfter === "refresh") pendingResponseFocus.current = "demo-screen-title";
    setResponse(next);
    recordAnalyticsEvent({ eventName: "results_shown", screen: "results", outcome: outcomeForResponse(next) });
    if (!append && focusAfter !== "refresh") navigate("results");
  }, [focusAfterRender, navigate, pagination]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseFilterInput({ priceMaxEUR: price, mileageMaxKm: mileage, sort, text });
    if (!parsed.ok) {
      const message = parsed.code === "unsupported_text" ? "La recherche libre n’est pas encore prise en charge. Effacez ce texte ou utilisez les filtres structurés." : "Vérifiez cette valeur avant de rechercher.";
      setFieldError({ field: parsed.field, message });
      window.requestAnimationFrame(() => document.getElementById(`demo-${parsed.field}`)?.focus());
      return;
    }
    setFieldError(undefined); setResponse(undefined); lastQuery.current = parsed.query;
    recordAnalyticsEvent({ eventName: "search_submitted", screen: "search", outcome: "success" });
    void runSearch(parsed.query, false);
  }

  function loadMore() {
    if (!response?.nextCursor || !lastQuery.current || loadingMore) return;
    appendStartIndex.current = response.results.length;
    recordAnalyticsEvent({ eventName: "retry_clicked", screen: "results", outcome: outcomeForResponse(response) });
    void runSearch(lastQuery.current, true);
  }

  function retrySearch() {
    if (!lastQuery.current) { navigate("search"); return; }
    recordAnalyticsEvent({ eventName: "retry_clicked", screen: "results", outcome: searchError === "offline" ? "offline" : "error" });
    void runSearch(lastQuery.current, false);
  }

  function refreshProjection() {
    if (!lastQuery.current || loading) return;
    recordAnalyticsEvent({ eventName: "retry_clicked", screen: "results", outcome: response ? outcomeForResponse(response) : "error" });
    void runSearch(lastQuery.current, false, "refresh");
  }

  function toggleSaved(listingId: ListingId, sourceScreen: DemoAnalyticsScreen) {
    const saved = favoriteSnapshot.listingIds.includes(listingId);
    if (saved && sourceScreen === "saved") removedFavoriteIndex.current = favoriteSnapshot.listingIds.indexOf(listingId);
    const changed = saved ? favorites.remove(listingId) : favorites.add(listingId);
    if (!changed) return;
    setAnnouncement(saved ? "Favori retiré. Vous pouvez annuler cette action." : "Ajouté aux favoris.");
    if (saved && sourceScreen === "saved") focusAfterRender("demo-favorite-undo");
    recordAnalyticsEvent({ eventName: saved ? "favorite_removed" : "favorite_added", screen: sourceScreen, outcome: "success" });
  }

  function undoFavorite() {
    if (!favorites.undo()) return;
    setAnnouncement("Le favori a été restauré à sa position précédente.");
    const restoredIndex = removedFavoriteIndex.current;
    if (restoredIndex !== undefined) focusAfterRender(`demo-saved-remove-${restoredIndex}`);
    recordAnalyticsEvent({ eventName: "favorite_undone", screen: "saved", outcome: "success" });
  }


  function armReset() { setResetArmed(true); focusAfterRender("demo-reset-confirm"); }
  function cancelReset() { setResetArmed(false); focusAfterRender("demo-reset-start"); }
  function confirmReset() {
    if (!favorites.reset()) return;
    setAnnouncement("Les favoris de cette version ont été effacés.");
    setResetArmed(false);
    focusAfterRender("demo-screen-title");
  }

  const effectiveSearch = screen === "results" && response === undefined;
  const storageMessage = storageCopy(favoriteSnapshot.storageStatus);

  return (
    <main className="demo-shell demo-main" id="demo-main" ref={markHydrated} tabIndex={-1}>
      <SyntheticDisclosure />
      <div className="demo-toolbar" aria-label="Navigation de la démonstration">
        <nav aria-label="Sections principales">
          <Button aria-current={screen === "search" || screen === "results" ? "page" : undefined} variant={screen === "search" || screen === "results" ? "primary" : "secondary"} onClick={() => navigate(response ? "results" : "search")}><SearchIcon />Recherche</Button>
          <Button aria-current={screen === "saved" ? "page" : undefined} variant={screen === "saved" ? "primary" : "secondary"} onClick={() => navigate("saved")}>Favoris ({favoriteSnapshot.listingIds.length})</Button>
        </nav>
        <label htmlFor="demo-theme">Apparence<select id="demo-theme" value={theme} onChange={(event) => changeTheme(event.target.value as Theme)}><option value="system">Automatique</option><option value="light">Clair</option><option value="dark">Sombre</option></select></label>
      </div>
      <p aria-live="polite" className="demo-announcement">{announcement}</p>

      {(screen === "search" || effectiveSearch) && enabled ? (
        <section aria-labelledby="demo-screen-title">
          <ScreenHeader title="Rechercher dans la démonstration" description="Ajustez des critères déterministes, puis parcourez uniquement les publications synthétiques actives." />
          {location.invalid ? <Banner tone="warning">Le lien demandé n’est pas valide. La recherche est de nouveau disponible.</Banner> : null}
          {effectiveSearch ? <Banner tone="info">Les résultats ne sont pas conservés après un rechargement. Relancez la recherche avec vos critères.</Banner> : null}
          <div className="demo-search-layout">
            <form className="demo-search-form" noValidate onSubmit={submitSearch}>
              <Field id="demo-text" label="Recherche libre" value={text} onChange={(event) => { setText(event.target.value); setFieldError(undefined); }} error={fieldError?.field === "text" ? fieldError.message : undefined} hint="Ce champ prépare une capacité future. Un texte non vide n’est jamais envoyé." autoComplete="off" />
              <Field id="demo-priceMaxEUR" label="Budget maximum (€)" inputMode="decimal" value={price} onChange={(event) => { setPrice(event.target.value); setFieldError(undefined); }} error={fieldError?.field === "priceMaxEUR" ? fieldError.message : undefined} autoComplete="off" />
              <button className="demo-advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}><FilterIcon />{advanced ? "Masquer les critères avancés" : "Afficher les critères avancés"}</button>
              {advanced ? <div className="demo-advanced">
                <Field id="demo-mileageMaxKm" label="Kilométrage maximum (km)" inputMode="decimal" value={mileage} onChange={(event) => { setMileage(event.target.value); setFieldError(undefined); }} error={fieldError?.field === "mileageMaxKm" ? fieldError.message : undefined} autoComplete="off" />
                <label htmlFor="demo-sort">Trier les résultats<select id="demo-sort" value={sort} onChange={(event) => { setSort(event.target.value as DemoSearchSort); setFieldError(undefined); }}><option value="listing_asc">Ordre stable de publication</option><option value="price_asc">Prix croissant (EUR d’abord)</option><option value="price_desc">Prix décroissant (EUR d’abord)</option><option value="mileage_asc">Kilométrage croissant (km d’abord)</option><option value="mileage_desc">Kilométrage décroissant (km d’abord)</option></select></label>
              </div> : null}
              <Button type="submit" loading={loading}>{loading ? "Recherche…" : "Rechercher"}</Button>
              {slow && loading ? <p className="demo-slow" role="status">La lecture prend plus de temps que prévu. Vous pouvez continuer à parcourir la page.</p> : null}
            </form>
            <NeutralIllustration />
          </div>
          {searchError ? <StatePanel tone="danger" title="Recherche indisponible" action={<Button onClick={retrySearch}>Réessayer</Button>}><p>{errorCopy(searchError)}</p></StatePanel> : null}
        </section>
      ) : null}

      {screen === "results" && response ? (
        <section aria-labelledby="demo-screen-title">
          <ScreenHeader title="Résultats synthétiques" description={response.state === "complete" ? `${response.totalCount} publication${response.totalCount > 1 ? "s" : ""} dans cet instant de démonstration.` : "Le nombre total ne peut pas être annoncé pour cet état."} action={<Button variant="secondary" onClick={() => navigate("search")}>Modifier les critères</Button>} />
          {response.state === "partial" ? <div className="demo-projection-state"><Banner tone="warning">La projection est partielle. Les éléments affichés restent consultables, mais la liste n’est pas complète.</Banner><Button variant="secondary" loading={loading} onClick={refreshProjection}>{loading ? "Actualisation…" : "Actualiser"}</Button></div> : null}
          {response.state === "stale" ? <div className="demo-projection-state"><Banner tone="warning">Cet instant de démonstration est ancien. Les éléments restent synthétiques et peuvent ne plus refléter la projection la plus récente.</Banner><Button variant="secondary" loading={loading} onClick={refreshProjection}>{loading ? "Actualisation…" : "Actualiser"}</Button></div> : null}
          {searchError ? <StatePanel tone="danger" title="Impossible de poursuivre la lecture" action={pageFailure && (searchError === "offline" || searchError === "cancelled" || searchError === "read_unavailable") ? <Button id="demo-page-retry" onClick={loadMore}>Réessayer la page</Button> : <Button onClick={retrySearch}>Recommencer la recherche</Button>}><p>{errorCopy(searchError)}</p></StatePanel> : null}
          {response.results.length === 0 ? <StatePanel title="Aucun résultat synthétique" action={<Button onClick={() => navigate("search")}>Ajuster les critères</Button>}><p>Aucune publication active ne correspond à ces critères.</p></StatePanel> : (
            <div className="demo-results" aria-busy={loadingMore || undefined}>
              {response.results.map((result, index) => <ResultCard key={result.listingId} index={index} result={result} saved={favoriteSnapshot.listingIds.includes(result.listingId)} onToggleSaved={() => toggleSaved(result.listingId, "results")} onOpen={() => { resultsReturnIndex.current = index; recordAnalyticsEvent({ eventName: "detail_opened", screen: "results", outcome: "success" }); navigate("detail", result.listingId); }} />)}
            </div>
          )}
          {loadingMore ? <LoadingResults label={slow ? "La page suivante prend plus de temps que prévu…" : "Chargement de la page suivante…"} /> : null}
          {response.nextCursor || loadingMore ? <div className="demo-load-more"><Button id="demo-load-more" aria-busy={loadingMore || undefined} aria-disabled={loadingMore || undefined} onClick={loadMore}>{loadingMore ? "Chargement…" : "Charger plus"}</Button></div> : null}
        </section>
      ) : null}

      {screen === "detail" && enabled ? (
        <section aria-labelledby="demo-screen-title">
          <ScreenHeader title="Détail de la publication synthétique" description="Les valeurs ci-dessous sont des observations de démonstration, pas une offre commerciale." backLabel="Retour aux résultats" onBack={() => navigate(response ? "results" : "search")} action={location.listingId ? <Button variant="secondary" onClick={() => toggleSaved(location.listingId!, "detail")}>{favoriteSnapshot.listingIds.includes(location.listingId) ? "Retirer des favoris" : "Ajouter aux favoris"}</Button> : undefined} />
          {detail.status === "loading" ? <LoadingResults label="Chargement du détail synthétique…" /> : null}
          {detail.status === "error" ? <StatePanel tone="danger" title={detail.code === "not_found" ? "Publication non disponible" : "Détail indisponible"} action={<Button onClick={() => setDetailRetry((value) => value + 1)}>Réessayer</Button>}><p>{detail.code === "not_found" ? "Cette publication synthétique est retirée, supprimée ou introuvable." : errorCopy(detail.code)}</p></StatePanel> : null}
          {detail.status === "ready" ? <div className="demo-detail"><NeutralIllustration /><p className="demo-status">{detail.result.availability === "active" ? "Publication active" : detail.result.availability === "withdrawn" ? "Publication retirée" : detail.result.availability === "deleted" ? "Publication supprimée" : "Publication introuvable"}</p><ResultSummary result={detail.result} /><EvidenceDetails result={detail.result} /></div> : null}
        </section>
      ) : null}

      {screen === "saved" ? (
        <section aria-labelledby="demo-screen-title">
          <ScreenHeader title="Favoris synthétiques" description={enabled ? "Les détails sont relus uniquement lorsque cet écran est actif." : "La démonstration est désactivée. Vous pouvez encore gérer les identifiants enregistrés localement."} action={enabled ? <Button variant="secondary" onClick={() => navigate(response ? "results" : "search")}>Retour à la recherche</Button> : undefined} />
          {!enabled ? <Banner role="note" tone="warning">La recherche et le détail sont désactivés. Aucun appel réseau n’est effectué depuis cet écran.</Banner> : null}
          {!online && enabled ? <Banner role="note" tone="warning">Vous êtes hors connexion. Les favoris restent gérables, mais leurs détails ne sont pas chargés.</Banner> : null}
          {storageMessage ? <Banner role="note" tone="warning">{storageMessage}</Banner> : null}
          {favoriteSnapshot.canUndo ? <div className="demo-undo"><span>Un favori vient d’être retiré.</span><Button id="demo-favorite-undo" variant="secondary" onClick={undoFavorite}>Annuler</Button></div> : null}
          {favoriteSnapshot.listingIds.length === 0 ? <StatePanel title="Aucun favori"><p>Ajoutez une publication synthétique depuis les résultats pour la retrouver ici.</p>{enabled ? <Button onClick={() => navigate(response ? "results" : "search")}>Rechercher</Button> : null}</StatePanel> : (
            <ol className="demo-saved-list">
              {favoriteSnapshot.listingIds.map((listingId, index) => {
                const outcome = savedDetails.get(listingId);
                const result = enabled && online && outcome?.ok ? outcome.data.results[0] : undefined;
                return <li key={listingId}><Card className="demo-saved-card"><div><p className="demo-status">Favori synthétique {index + 1}</p>{enabled && online && outcome === undefined ? <span>Chargement du détail…</span> : null}{result ? <ResultSummary result={result} /> : null}{enabled && online && outcome && !outcome.ok ? <p>Détail indisponible. Le favori est conservé.</p> : null}{(!enabled || !online) ? <p>Détail non chargé dans cet état.</p> : null}</div><div className="demo-card-actions">{enabled && online && result ? <Button onClick={() => navigate("detail", listingId)}>Voir le détail</Button> : null}<Button id={`demo-saved-remove-${index}`} variant="secondary" onClick={() => toggleSaved(listingId, "saved")}>Retirer</Button></div></Card></li>;
              })}
            </ol>
          )}
          {(favoriteSnapshot.listingIds.length > 0 || storageMessage) && favoriteSnapshot.storageStatus !== "future" ? <div className="demo-reset">{resetArmed ? <><p>Confirmez la suppression des favoris de cette version de démonstration.</p><Button id="demo-reset-confirm" onClick={confirmReset}>Confirmer la réinitialisation</Button><Button variant="secondary" onClick={cancelReset}>Conserver</Button></> : <Button id="demo-reset-start" variant="secondary" onClick={armReset}>Réinitialiser les favoris</Button>}</div> : null}
        </section>
      ) : null}
    </main>
  );
}
