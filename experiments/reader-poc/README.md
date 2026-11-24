# AutoFindex Reader POC — moteur de lecture inspiré de l'architecture Jina

**État : prototype isolé, non admis en production.** La ressemblance avec Jina porte sur la chaîne générale **HTTP → cache → rendu Chromium facultatif → extraction → API**, pas sur son accès aux sites protégés, sa couche SaaS privée ni sa facturation. Aucun mécanisme de dissimulation, rotation d'IP, détournement de session, résolution CAPTCHA ou contournement DataDome n'est inclus.

## Première exécution (Node.js 22+)

```bash
cd experiments/reader-poc
npm test
npm run demo
npm run serve
# sur une autre console :
curl -sS http://127.0.0.1:8787/health
curl -sS -X POST http://127.0.0.1:8787/v1/extract \
  -H 'Content-Type: application/json' \
  --data-binary "$(node -e 'const fs=require("fs"); console.log(JSON.stringify({html:fs.readFileSync("fixtures/car.html","utf8")}))')"
```

**Tout fonctionne hors réseau** : les annonces Porsche sont fictives. Aucune requête réelle vers Leboncoin n'est émise. Le serveur expose `POST /v1/extract-list` qui extrait les annonces d'une page de résultats structurée, et `POST /v1/extract` qui convertit du HTML **déjà obtenu de façon autorisée** en JSON automobile, et `POST /v1/read` désactivé tant qu'un propriétaire de source n'a pas fourni un registre de droits vérifié côté serveur.

## Modules

- `src/listing.mjs` : extraction de plusieurs cartes d'une page de résultats JSON-LD/ItemList (déduplication, restriction à l'origine).
- `src/extract.mjs` : extraction déterministe à partir de JSON-LD schema.org/Car, champs automobiles et hash SHA-256, sans données personnelles vendeur.
- `src/reader.mjs` : validation des sources, allowlist HTTPS, lecture HTTP bornée, cache ETag/304, actualisation, historique de changements, erreurs typées, aucun retry de refus.
- `src/browser.mjs` : navigateur Chromium facultatif via Playwright **à installer séparément** ; ne lance ni automatisation de blocage ni résolution de challenge.
- `src/server.mjs` : API locale sans dépendance externe (`GET /health`, `POST /v1/extract`, `POST /v1/extract-list`, `POST /v1/read`).
- `fixtures/` et `test/` : cas fictifs couvrant extraction, cache, hausse/baisse du prix, JS rendu, droits, défis et API.

Pour activer le navigateur dans une **composition autorisée** uniquement : installer Playwright et son Chromium dans un conteneur isolé ; importer `renderWithChromium` et l'injecter dans `createReader({renderBrowser, ...})`. Aucun navigateur n'est installé automatiquement ici.

## Protection et limites

- **Les droits ne sont pas auto-validés** : `evidenceRef` est une déclaration, jamais une vérification juridique ni technique. Dans AutoFindex, le Source Registry et le Connector SDK doivent authentifier et contrôler l'autorisation, la révocation, le périmètre, la fréquence et les obligations par acquisition.
- Aucun site réel n'est configuré par défaut. Une source `fixtureOnly` nécessite l'injection explicite d'un transport de tests ; aucune donnée réelle n'est stockée ni redistribuée.
- Pas de réécriture du Connector SDK ni de modification du produit. La mémoire locale du cache n'est pas durable, n'est pas multi-instance et n'est pas une preuve de fraîcheur d'annonces réelles. Les tests ne prouvent pas le débit industriel.
- Pour un usage réseau réel, durcir encore l'egress (DNS rebinding, IP internes) et les robots, respecter les limites contractuelles, et brancher le registre d'autorité côté serveur. Le navigateur doit interdire les sous-requêtes/redirects hors périmètre. Le POC n'est pas un collecteur exploitable en production.
- Une page de résultats sans `ItemList` JSON-LD structuré retournera zéro carte ; la pagination réelle et sa taille ne sont pas prouvées.
- L'extraction donne la priorité à JSON-LD, car un simple balayage de chiffres dans une page risquerait de mélanger plusieurs véhicules. Les fiches sans données structurées restent incomplètes ; une règle propre à chaque flux autorisé sera nécessaire.

## Trajectoire d'intégration

Conserver ce module uniquement dans `experiments/` pour les tests synthétiques. Après revue Codex indépendante, créer un adaptateur formel entre `createReader.read` et les ports autorisés du Connector SDK (`fetchPage`, `mapPage`) en respectant les contrats ADR-0002/0003. Le calendrier, les licences et les flux par source restent des étapes distinctes.
## Conversion documentaire et recherche

L’[API de lecture et de recherche](document-api/README.md) complète le prototype automobile. Elle fournit une URL de lecture, l’import HTML/PDF/Office, la recherche locale persistante et des profils facultatifs pour le rendu et la recherche web. Son port local est 8788.
