"use client";

import { useRef, useState, useSyncExternalStore } from "react";

import { getImportGroups, type SellerKind } from "./dossier";

const prefix = "auto-world.import.de-fr.v1.";
const sellerKinds: readonly SellerKind[] = ["unknown", "professional", "private"];
const itemIds = new Set(sellerKinds.flatMap(seller =>
  getImportGroups(seller).flatMap(group => group.items.map(item => item.id)),
));

interface Draft {
  seller: SellerKind;
  checked: ReadonlySet<string>;
  storage: "loading" | "saved" | "memory";
}

const initialDraft: Draft = { seller: "unknown", checked: new Set(), storage: "loading" };

function readSeller(value: string | null): SellerKind {
  return value === "professional" || value === "private" ? value : "unknown";
}

function createChecklistStore() {
  let draft = initialDraft;
  const listeners = new Set<() => void>();

  function publish(next: Draft) {
    draft = next;
    for (const listener of listeners) listener();
  }

  function reload() {
    try {
      const local = window.localStorage;
      const seller = readSeller(local.getItem(prefix + "seller"));
      const checked = new Set<string>();
      for (const id of itemIds) {
        if (local.getItem(prefix + id) === "1") checked.add(id);
      }
      publish({ seller, checked, storage: "saved" });
    } catch {
      publish({ ...draft, storage: "memory" });
    }
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    function reconcile(event: StorageEvent) {
      if (draft.storage === "saved" && (event.key === null || event.key.startsWith(prefix))) reload();
    }
    window.addEventListener("storage", reconcile);
    if (draft.storage !== "memory") reload();
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", reconcile);
    };
  }

  // Each edit owns one key, so simultaneous edits to different items can coexist.
  function save(key: string, value: string | null, next: Draft) {
    if (draft.storage === "saved") {
      try {
        if (value === null) window.localStorage.removeItem(prefix + key);
        else window.localStorage.setItem(prefix + key, value);
      } catch {
        publish({ ...next, storage: "memory" });
        return;
      }
    }
    publish(next);
  }

  return {
    subscribe,
    getSnapshot: () => draft,
    startNewDossier() {
      let storage = draft.storage;
      try {
        window.localStorage.removeItem(prefix + "seller");
        for (const id of itemIds) window.localStorage.removeItem(prefix + id);
      } catch {
        storage = "memory";
      }
      publish({ ...initialDraft, storage });
    },
    setSeller(value: string) {
      const seller = readSeller(value);
      save("seller", seller === "unknown" ? null : seller, { ...draft, seller });
    },
    setChecked(id: string, selected: boolean) {
      const checked = new Set(draft.checked);
      if (selected) checked.add(id);
      else checked.delete(id);
      save(id, selected ? "1" : null, { ...draft, checked });
    },
  };
}

export function ImportChecklist() {
  const [store] = useState(createChecklistStore);
  const draft = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initialDraft);
  const sellerSelect = useRef<HTMLSelectElement>(null);
  const ready = draft.storage !== "loading";
  const groups = getImportGroups(draft.seller);
  const items = groups.flatMap(group => group.items);
  const remaining = items.filter(item => !draft.checked.has(item.id));
  const count = items.length - remaining.length;
  const Row = ready ? "label" : "div";

  return (
    <section className="import-checklist" aria-labelledby="checklist-title">
      <h2 id="checklist-title">Mes préparatifs</h2>
      <div className="import-controls" aria-busy={!ready}>
        <label className="import-seller">
          Type de vendeur
          <select ref={sellerSelect} className="site-select" disabled={!ready} value={draft.seller} onChange={event => store.setSeller(event.target.value)}>
            <option value="unknown">À préciser</option>
            <option value="professional">Professionnel</option>
            <option value="private">Particulier</option>
          </select>
        </label>
        <div className="import-progress" role="status" aria-atomic="true">
          <strong>{ready ? `${count} sur ${items.length} préparatifs cochés` : "Lecture de votre suivi…"}</strong>
          {remaining[0]
            ? <p className={ready ? undefined : "import-pending"}>À préparer ensuite · {remaining[0].label}</p>
            : <p>Tous les préparatifs sont cochés. Vous pouvez poursuivre auprès des services officiels.</p>}
        </div>
        <p className="import-storage">
          {draft.storage === "memory"
            ? "Le stockage est indisponible. Votre progression reste sur cette page."
            : "Un dossier à la fois. Votre choix et vos coches restent dans ce navigateur."}
        </p>
      </div>
      <noscript><p>Vous pouvez lire la liste et accéder aux démarches officielles. JavaScript permet de cocher les préparatifs et de retrouver votre progression.</p></noscript>
      {groups.map(group => (
        <section key={group.id} className="import-group" aria-labelledby={"group-" + group.id}>
          <h3 id={"group-" + group.id}>{group.title}</h3>
          <ul>
            {group.items.map(item => (
              <li key={item.id}>
                <Row className="import-item">
                  <input type="checkbox" disabled={!ready} className={ready ? undefined : "import-pending"} checked={draft.checked.has(item.id)}
                    aria-labelledby={"label-" + item.id} aria-describedby={"detail-" + item.id}
                    onChange={event => store.setChecked(item.id, event.target.checked)} />
                  <span>
                    <strong id={"label-" + item.id}>{item.label}</strong>
                    <small id={"detail-" + item.id}>{item.detail}</small>
                  </span>
                </Row>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ready && (draft.seller !== "unknown" || draft.checked.size > 0) && (
        <button type="button" className="aw-button aw-button--secondary" onClick={() => {
          if (window.confirm("Recommencer avec un dossier vide ? Le type de vendeur et toutes les coches de ce dossier seront effacés.")) {
            store.startNewDossier();
            sellerSelect.current?.focus();
          }
        }}>Commencer un nouveau dossier</button>
      )}
    </section>
  );
}
