# TASK-XXXX — Résultat concret

Modèle à copier dans `roadmap/tasks/` ou champs manquants à intégrer dans une fiche existante. Adapter les liens à la destination. Lier les critères existants au lieu de les dupliquer ; aucune valeur d'exemple n'est une preuve.

## Brief / Definition of Ready

- Statut, priorité, voie, propriétaire, branche et base Git : à renseigner.
- Résultat utilisateur / parcours V1 / condition de succès : à renseigner.
- Dépendances et checkpoints d'acceptation : liens vérifiés avant exécution.
- Périmètre, exclusions, contrats et composants réutilisés : liens.
- Type / risque / incertitude : local, parcours ou frontière sensible ; justification.
- Rôles **Codex uniquement** : responsable/exécutant, reviewer distinct, spécialiste si nécessaire avec raison.
- Modèle et effort réellement employés par rôle : observés, ou `unknown` avec raison.
- Ressources : checkout propriétaire, fichiers attribués, ports/processus, contraintes de concurrence.
- Budget connu et point de réévaluation : pas de quota inventé ; réévaluer après deux essais sans nouvelle information.

## Acceptation et vérification

| Critère observable | Contrôle prévu / cas limite | Preuve attendue |
| --- | --- | --- |
| À définir avant réalisation | Test, inspection ou parcours réel | Commande/artefact/revue lié à la source |

UI : parcours, chargement/vide/erreur/offline/succès et cas difficiles, composants partagés, vues représentatives, clavier/lecteur d'écran, texte agrandi et budget de performance selon PRODUCT_UX. Justifier toute non-applicabilité.

## Plan d'exécution

1. Préparer contrats, fixtures valides et recettes exactes de build/test.
2. Réaliser la tranche complète et vérifier tôt les risques.
3. Présenter la première proposition complète, faire relire, corriger et exécuter les gates finaux.

Adapter les étapes à la tâche. Copier le plan dans la PR avant livraison.

## Commandes et gates

- Préparation/outillage/dépendances : commandes exactes, ordre et environnement.
- Boucle ciblée : contrôles et régressions voisines.
- Final : lint/types/tests/build des packages affectés, secrets/audit et tout gate imposé ; source/main selon le contrat. Exclusions, retries et caches indiqués.
- Revue indépendante : rôle, critères et artefacts ; checkout en lecture seule.

## Exploitation et livraison

- Logs/mesures, sécurité, migration/retour arrière : changement concret ou non-applicabilité justifiée.
- Validation : lien vers `docs/validation/TASK-XXXX.md` et checkpoint final de PR.
- Prochaine action / blocage / responsable : explicites ; validation locale distincte de l'acceptation finale.
- Pilote : inscription avant exécution si admissible ; conserver échecs/abandons et données inconnues.

La DoD et ADR-0028 restent obligatoires. Le modèle n'autorise aucune tâche ni livraison à lui seul.
