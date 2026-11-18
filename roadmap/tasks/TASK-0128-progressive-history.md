# TASK-0128 — Lecture progressive des historiques

## Brief et Definition of Ready

P1, voie produit synthétique, pilote 3/6. Responsable et exécutant unique Codex gpt-6.2-astra / ultra, branche `codex/task-0128-progressive-history`, base `5d0599cdeb3589b0c2ab0e42778769c9ad771b32`. Statut IN_PROGRESS. Le propriétaire a autorisé ce lot indépendant de PR256 et des deux autres surfaces. Le parent coordonne les fichiers communs, la fusion et les contrôles main.

La [fiche historique existante](TASK-0110-synthetic-observation-history.md) est acceptée sur [PR177](https://github.com/CleMeY15/auto-world/pull/177#issuecomment-6248301095). Appliquer le [contrat UX](../../docs/PRODUCT_UX.md), la [DoD](../../docs/DEFINITION_OF_DONE.md) et [ADR-0028](../../docs/decisions/ADR-0028-v1-prototype-functional-gate.md). L'état de navigation des autres lots ne conditionne pas ce parcours.

## Acceptation et plan

1. Sur la fiche, garder la valeur sélectionnée, le résumé natif et les indications de provenance. Ouvrir chaque champ puis parcourir les observations conservées par groupes de huit. Conserver l'ordre de la projection, les instants égaux, les devises, unités, dates et confiances. Le dernier groupe peut être incomplet.
2. Limiter le montage initial à huit lignes par champ. Donner le nombre lu sur le total et placer le focus sur la première nouvelle ligne après activation, y compris à la dernière page. Conserver la progression à la fermeture du résumé, recommencer à la nouvelle annonce. Vérifier les champs indépendants et le clavier, hors connexion sans requête ni écriture locale.
3. Utiliser le composant history-components, ses styles dédiés et les tests historiques. Réemployer les sélecteurs et formateurs V2 et les primitives du design system. Risques principaux : perte au bord d'un groupe, focus sur body, fuite entre publications, coût du rendu et débordement à 200 %.
4. Qualifier les fixtures via le parseur, puis les bornes vide/singleton/8/9/256, états partiel, ancien, erreur, attente et hors ligne, changement d'annonce, axe, captures mobile/bureau et budget de retour visuel. Figer HEAD/tree et sérialiser lint, types, tests, build, secrets, audit et suites navigateur. Revue indépendante code, architecture et pixels, Codex gpt-6.2-astra / ultra.
5. Publier une PR vers main avec preuves et rollback. Revert ciblé de la présentation, sans migration ni nouvelle collecte. Budget inconnu, réévaluer après deux échecs identiques. Checkout, namespace réseau sans sortie et processus dédiés à 0128.

[Validation et mesures du pilote](../../docs/validation/TASK-0128.md).
