# TASK-0137 — Prouver une collecte leboncoin autonome et répétée

## Brief / Definition of Ready

- Statut : IN_PROGRESS, priorité utilisateur du 22 novembre 2026.
- Responsable/exécutant : contexte Codex principal ; revue indépendante : contexte Codex distinct. Modèle annoncé GPT-6 Astra Pro ; effort effectif et coût non exposés, `unknown`.
- Branche : `spike/0137-leboncoin-autonomous`, base TASK-0136 `e935eb923624894afd5ea8fc020cf14fb7e17c03`. PR empilée sur `spike/0136-leboncoin-feasibility`.
- Résultat demandé : notre propre code ouvre une annonce réelle, enregistre les champs utiles puis recommence automatiquement à des dates distinctes. Une exécution planifiée qui échoue n'est pas une collecte réussie.
- Dépendances : [TASK-0136](TASK-0136-leboncoin-feasibility.md), [ADR-0036](../../docs/decisions/ADR-0036-owned-acquisition.md), [validation du premier essai](../../docs/validation/TASK-0136.md).
- Autorisation : l'utilisateur demande explicitement un essai autonome régulier sur leboncoin. Cette expérience isolée ne constitue aucune permission de production, redistribution publique ou activation du registre source.
- Ressource exclusive : checkout `auto-world-acquisition`. Aucun service/check-out du VPS, port public ou catalogue existant modifié. Qualité sérialisée dans ce checkout.
- Risque principal : accès réel non encore établi. Arrêt sur refus, challenge ou extraction incomplète ; pas de changement d'identité réseau, cookies importés, furtivité, résolution de CAPTCHA ou API de scraping tierce.

## Contexte d'exécution vérifié

Chromium local échoue avant navigation (socket interdit). Le VPS de développement est documenté, mais la connexion SSH de cette session échoue avant connexion et hPanel demande une authentification. Les workflows du projet exécutent déjà Playwright sur des runners Linux. Un workflow de diagnostic dédié peut donc tester le programme hors de l'environnement local, sans toucher la CI générale ni les services du site.

## Plan, à publier dans la PR avant réalisation

1. Résoudre Playwright depuis la dépendance figée du dépôt, et installer son Chromium correspondant sur un runner Linux standard. Aucun affaiblissement des protections du système en cas d'échec.
2. Exécuter un workflow dédié, limité à cette branche et au premier commit d'implémentation après le plan. Une seule URL connue, contexte neuf, limite fonctionnelle existante de 30 secondes ; aucune relance après échec.
3. Si et seulement si la première extraction est complète, déclencher automatiquement deux nouvelles observations de la même URL, espacées de cinq minutes au minimum. La séquence s'arrête au premier résultat non exploitable. Trois passages constituent une preuve courte de répétition, pas une validation de disponibilité sur 24 heures.
4. Conserver les projections et résultats localement sur le runner. Publier uniquement un résumé strictement autorisé : heures, version, statut, champs numériques automobiles, empreintes et compteurs. Pas de texte libre d'annonce, photo, VIN/plaque, contact, cookie ou corps de challenge dans les logs/artefacts publics.
5. Selon le résultat, préparer le même programme pour un ordonnanceur durable sur l'environnement du projet ; n'annoncer aucun cron actif ni succès futur sans preuve d'installation et d'exécution. Une connexion indispensable est un blocage à exposer clairement.

## Critères et preuves

| Critère | Contrôle |
| --- | --- |
| Un vrai navigateur autonome démarre et navigue | Rapport du runner : environnement, révision, tentative, statut de navigation |
| Une vraie annonce est exploitable | `extracted`, `core_fields_observed`, prix/km observés, SHA des captures |
| La répétition est autonome | Trois démarrages distincts déclenchés par le programme, avec intervalle mesuré ; aucun rejeu de fixture |
| Un échec ne provoque pas de contournement | Tests hors réseau de l'arrêt et vérification du nombre de tentatives |
| Les preuves publiées restent bornées | Tests de projection des rapports, absence des valeurs non autorisées |
| Le déclencheur n'active pas une collecte générale | Branche/événement/parent du commit/run attempt bornés ; aucun secret ni `schedule` général |

## Vérification et livraison

Contrôles ciblés Node, lint, validation de workflow et Secretlint ; installation figée/audit, gates CI applicables et revue indépendante. Aucun test navigateur local supplémentaire tant que la restriction de socket est inchangée. Le job GitHub reçoit les 360 minutes prévues par AGENTS ; les délais fonctionnels restent courts et la séquence bornée. Réévaluer après un refus de source ou deux échecs d'environnement sans information nouvelle.

Le statut final distingue test d'accès, répétition courte, installation durable et couverture de catalogue. Découverte de nouvelles annonces, copie des photos, exhaustivité du site et intégration de production ne sont pas prouvées par cette séquence.

Retour arrière : désactiver le workflow dédié ou retirer ses fichiers par revert ciblé ; aucun service produit ou registre à restaurer. Les preuves historiques restent conservées.
