# TASK-0137 — Pilote Camofox sur trois annonces

## Pilote de répétabilité Camofox — plan du 22 novembre 2026

Autorisation utilisateur : « Vas-y on fait ça », après proposition d'un petit pilote multi-annonces et répété. Propriétaire : coordinateur Codex ; implémentation, tests ciblés délégués et revue indépendante en contextes distincts, modèle/effort hérités sans changement demandé (effort exact non exposé). Périmètre TASK-0137, branche existante ; point de départ ff7b9558ba5f0e672619ee77cad2ac7086e42903.

- Figer les trois annonces déjà observées : 3305814470, 3312238672, 3308374007. Deux passages séquentiels, au maximum six ouvertures, 30 secondes entre observations et au moins cinq minutes entre la fin du premier passage et le début du second.
- Réutiliser Camofox 1.19.0 / Firefox 152.0.4-beta.30 au commit amont figé, Ubuntu 22.04 / Node 22.23.2. Une instance temporaire neuve par observation, configuration amont, aucun proxy, cookie importé, interaction CAPTCHA ni retry.
- Paramétrer la cible du lecteur existant sans modifier son comportement par défaut. Chaque identité chiffrée doit lier cible, passage, ordinal, manifeste, révision et run. Une enveloppe par observation ; fragments regroupés par SHA.
- Qualifier l'extraction avec URL exacte, statuts REST/navigation séparés, titre/prix uniques et normalisation déterministe des champs centraux. La troncature du snapshot général reste une limite explicite ; elle ne remplace pas l'examen du DOM structuré. Le reçu historique du premier test reste inchangé.
- Arrêter au premier résultat inexploitable, refus/vérification, erreur d'environnement ou nettoyage non établi ; conserver les tentatives manquantes comme non exécutées. Aucune déduction de retrait depuis un échec.
- Produire un bilan prévu/tenté/extrait, les heures et intervalles mesurés, trois paires possibles et les changements de champs. Une réussite complète prouve uniquement cette fenêtre et ces trois annonces.
- Workflow isolé à déclenchement unique, parent de plan fixé, premier run/première tentative, job 360 minutes avec délais fonctionnels bornés. Aucun horaire durable, registre source, service produit, base ou V1 modifié.
- Tests hors réseau sur identité multi-cible, faux succès, troncature, arrêt global, espacement réel, comparaison des valeurs, fragments et nettoyage ; lint, secrets, syntaxe et revue indépendante avant essai. Vérification des preuves originales après run.
- Ressources : six ouvertures au plus, environ sept minutes de pauses au total, plus installation et délais de navigation. Coût financier non mesuré. Réévaluation au premier échec. Retrait par revert ciblé ; conserver les preuves.

Prérevue indépendante favorable sur ce protocole. Implémentation et essai à venir ; aucun résultat de répétabilité anticipé.

## Implémentation et validation locale

Le plan documentaire est publié dans `f3c30d19afedcd796804e84b2a63bc4c93175cb5`. Le lecteur historique garde sa cible et son comportement par défaut ; un export paramétrable permet trois cibles fixes. Le pilote ajoute les identités par passage/ordinal/manifeste, un verdict de normalisation distinct du snapshot général, un bilan fermé et une preuve chiffrée séparée par observation. Les fichiers de profils et cookies ne sont pas dans les artefacts.

- `node --test connectors/leboncoin-spike/probe-camofox.test.mjs connectors/leboncoin-spike/pilot-camofox.test.mjs` : **41 PASS**, zéro échec/exclusion/retry, Node 24.22.3 local ; nouvelle exécution Node 22.23.2 prévue dans le job natif.
- `pnpm exec eslint ...` : lancement refusé avant lint, versions locales pnpm 11.25.0 / Node 24.22.3 différentes des versions prescrites. Aucun seuil ni exigence modifié.
- `node node_modules/eslint/bin/eslint.js connectors/leboncoin-spike/probe-camofox.mjs connectors/leboncoin-spike/pilot-camofox.mjs connectors/leboncoin-spike/pilot-camofox.test.mjs --max-warnings=0` : **PASS**, linter installé du dépôt exécuté directement.
- `node scripts/check-secrets.mjs` : **PASS**, 1 698 fichiers.
- Syntaxe YAML, garde du parent de plan, absence de schedule durable, disponibilité de la clé de déchiffrement et `git diff --check` : **PASS**.
- Aucun package TypeScript, application ou schéma de production changé ; les gates généraux GitHub restent distincts de ces contrôles ciblés.

Prérevue et revue finale indépendantes favorables. Défaut trouvé avant présentation et corrigé : contrôler également les intervalles entre horodatages des captures, pas seulement les attentes du programme. Le cas contradictoire est couvert par un test. Les captures synthétiques des tests ne servent pas de preuve d'accès réel.

Empreintes source gelées avant exécution : probe `868a5b0c8a87612d558af6e0abced678e42ee2fad829b1d52b5d1574518e45bf`, pilote `0893a5f0678aa69c6ceaaa3b02eef9cdf462f8d5331b7d06ec72b37d703f1df8`, tests `ecfefde56c927a86bcbccaa73157545ee698516382b4d8026da13fd1eefdb35f`, workflow `f93486cba3e4e03ccdc16b5aa6d5eff652b83160d720d699b176866973e63c7f`.

Les comparaisons portent sur les huit champs normalisés title, brand, model, model_year, price, mileage, issuance_date et vin ; elles ne portent pas sur toute la page. Les valeurs et la normalisation sont reconstructibles depuis le DOM chiffré et la source figée ; seuls leurs hashes sont dans le bilan public. Le statut HTTP est celui du goto initial rapporté par Camofox, pas un statut final corrélé. Corps HTTP et couverture complète des iframes restent non établis. Les photos sont des références, pas des fichiers téléchargés.

## Résultats réels

Exécution native à lancer ; aucun résultat supplémentaire établi. Le pilote horaire ChatGPT antérieur a été relu comme désactivé avant ce lancement ; il reste distinct et n'a pas été réactivé.
