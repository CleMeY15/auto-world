# TASK-0141 — Diagnostic du signal anti-bot à la 9ᵉ page

Date : 2026-11-24.

## Contexte et vérité des résultats
- Benchmark Jina Reader pages de recherche (run `45259765450`) : pages 1–8 traitées (271 cartes distinctes **estimées**), page 9 reçue avec HTTP 200, classification `verification`, puis arrêt. Aucun contenu brut ni motif exact n'a été enregistré.
- Ancienne regex de détection : `you have been blocked|access denied|datadome|captcha|verify that you are human|verification required|vérification de sécurité|challenge-platform`. Elle mélange vrais contrôles et mentions ordinaires.
- Impossible de confirmer rétrospectivement le CAPTCHA exact à partir des anciens journaux ; une nouvelle observation sera nécessaire, et le contenu peut avoir changé entre-temps.

## Livraison
1. Mettre en place un détecteur **explicable** par groupes de motifs **définis à l'avance** : `explicit_denial`, `human_verification`, `challenge_provider`, `generic_keyword`. Journaux ne contenant que **nom de règle, catégorie, occurrence, position approximative, booléen**, sans passage de texte de la réponse.
2. Diagnostiquer la présence d'un formulaire, iframe ou marqueur de widget de vérification (HTML/Jina markdown), sans interaction avec ceux-ci.
3. Compter indépendamment les cartes automobiles et les liens de fiches contenus dans la même réponse avant l'arrêt (pas de stockage de fiches, téléphones, photos, prix, annonce ou body).
4. Tests unitaires **hors réseau** : refus 403/429, un HTML 200 avec véritable contrôle, faux positif de simple mention, contenu automobile présent avec un mot clé, absence d'indice, et aucune donnée personnelle dans les rapports.
5. Vérification **limitée à une unique requête Jina** de la page `recherche?category=2&page=9`, sans login, CAPTCHA solver, proxy, rotation, retry ni navigation au-delà. Stopper même si diagnostic "mention seulement" : ce travail est diagnostic, pas relance du scraping.
6. Résultat sous forme de JSON agrégé anonymisé sur artefact GitHub (rétention 7 jours) et rapport succinct de la classification et des incertitudes. Pas de modification PostgreSQL. PR distincte en brouillon.
7. Vérifier que le pipeline CI indique bien l'état réel ; ni HTTP 200, ni exécution réussie ne suffisent à prouver une autorisation d'accès ni un CAPTCHA réel.

## Conditions d'arrêt
- Une requête maximum ; timeout de 65 s, corps lu au maximum 3 MB, HTTP non 200 analysé comme refus/erreur et **pas** comme absence de données. Aucun contournement d'une protection réelle.
- Périmètre : diagnostic, pas de test de 500 annonces supplémentaire.

## Conclusion attendue
Classer `explicit_challenge` / `possible_challenge` / `keyword_only` / `no_signal` / `http_or_network_failure` avec preuves par nom de règle seulement. Si réponse différente de celle du test initial, l'indiquer explicitement.
