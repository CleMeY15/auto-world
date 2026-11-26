# Source Registry

Dependency-free V1 declared-policy contract for source governance. It records immutable configuration and audit revisions, evaluates a specific request against the current contextual grant, and derives operational health separately from legal eligibility.

## Public API

- `parseSourceRegistry` validates and reconstructs a complete registry history.
- `appendSourceRevision` accepts only the next valid transition or an identical replay of the latest complete revision.
- `evaluatePolicyEligibility` evaluates one territory, acquisition method, audience and complete field set at an explicit time.
- `deriveSourceHealth` produces deterministic health status and ordered reasons from an explicit sample and time.

All functions return the shared `ValidationResult`. Failures contain only stable issue codes and schema-owned paths. Successful objects are detached from caller inputs and deeply frozen.

## Safety boundary

A structurally eligible result is not proof of a licence and is not permanent permission to acquire or redistribute data. Production callers must reload the authoritative current registry, authenticate and audit changes, verify referenced authorization evidence, enforce all returned policy obligations, and evaluate every acquisition or publication action again.

The package never:

- registers or enables a real source;
- retrieves credentials or accepts credential values;
- performs network acquisition, deletion or takedown work;
- changes eligibility from health measurements;
- exposes VIN or seller PII outside explicitly internal clauses;
- verifies that an authorization, actor or policy reference exists.

Only `schemaVersion: 1` is supported. The authoritative state machine, policy vocabulary, compatibility rules and rollback boundary are documented in `docs/decisions/ADR-0002-source-registry-contract.md`. Durable authenticated storage, compare-and-swap, runtime observability and obligation enforcement belong to later connector infrastructure.

## Lecture du catalogue privé Leboncoin

Le serveur lance le contrôle avant chaque lecture de liste ou de fiche.

```sh
node packages/source-registry/bin/catalog-publication-grant.mjs "$REGISTRE" /etc/aw-private-web/catalog-admission.json "$JUSTIFICATIF"
```

Le premier fichier contient la révision courante du registre authentifié. Le deuxième consigne l'admission indépendante des lots, décidée par l'opérateur pour le site privé. Le troisième contient les octets de la pièce vérifiée lors de cette décision. Les trois chemins absolus doivent être distincts. Le contrôle vérifie que chaque fichier est régulier et que les fichiers et leurs répertoires appartiennent à root et interdisent l'écriture au groupe et aux autres utilisateurs. Il refuse les liens symboliques. Le registre et la pièce justificative admettent chacun jusqu'à 16 Mio, l'admission jusqu'à 64 Kio. Le candidat livré dans `data/src_leboncoin_fr.json` reste désactivé.

L'admission JSON comporte les champs suivants.

| Champ | Valeur ou contrôle |
| --- | --- |
| `version`, `site`, `audience`, `sourceId` | `1`, `autofind.tech`, `consumer`, `src_leboncoin_fr` |
| `registryRevision`, `registrySha256` | Numéro du dernier événement et SHA-256 des octets du registre entier |
| `evidenceRef`, `evidenceSha256` | Référence `basisRef` de la politique et SHA-256 des octets du justificatif validé |
| `domBatchIds` | Identifiants de lots DOM admis, chacun en 32 chiffres hexadécimaux minuscules |
| `rustExportSha256` | Empreintes des exports Rust admis, chacune en 64 chiffres hexadécimaux minuscules |

Chaque liste contient au plus 256 identifiants uniques. L'opérateur doit admettre au moins un lot. Les deux listes figurent dans le résultat et le lecteur doit les appliquer aux fiches et aux galeries. L'opérateur publie le registre, la preuve et l'admission en fichiers indépendants par remplacement atomique. Une incohérence pendant la mise à jour ferme la lecture. Un retrait au registre s'applique dès la requête suivante. Pour retirer tous les lots, retirer le fichier d'admission. Ces fichiers courants se gèrent hors des artefacts de déploiement et restent en place en cas de retour arrière du code. L'empreinte lie la lecture à la pièce validée par le responsable. Elle ne permet pas d'authentifier à elle seule son signataire.

La décision porte sur le périmètre consommateur France de la source `src_leboncoin_fr`, les identifiants et liens, la description des véhicules, le kilométrage, le prix et les références photo. Le site attribue ces références à Leboncoin et conserve les octets des images à la source. Le résultat JSON contient les dates de validité du droit ainsi que les durées maximales des données normalisées et des références photo. Pour ces dernières, `mediaSeconds` est le plus petit de deux plafonds, la rétention normalisée et les 30 jours appliqués aux galeries de l'essai. SQL applique aussi l'échéance de l'observation enregistrée. Dans le registre, la rétention `mediaSeconds` des copies binaires vaut zéro en mode référence.

Un échec rend le catalogue indisponible. L'évaluation de la politique source s'ajoute au contrôle de session et à l'admission explicite des lots de l'essai dans le catalogue privé.
