# TASK-0125 — Installer le fonctionnement full Codex

Status: IN_PROGRESS / IMPLEMENTATION_AND_REVIEW. Priority P1, voie processus indépendante. Owner: responsable Codex de cette demande. Branche `codex/full-codex-development`, base `e3e8297cfb68540c3af4703b552e16e19ed39d4a`. Autorisation : accord utilisateur sur la proposition du 16 novembre 2026, puis contrainte explicite full Codex.

## Objectif et DoR

Permettre à un agent entrant de sélectionner la bonne tâche, travailler avec un brief suffisant, valider une source figée, transmettre des preuves et mesurer les reprises sans nouvelle plateforme. Première version manuelle ; les six tâches produit du pilote ne sont pas exécutées par cette installation.

Dépendances : contrats existants et accord utilisateur acquis. TASK-0124 acceptée selon le [checkpoint PR235](https://github.com/CleMeY15/auto-world/pull/235#issuecomment-6745769896), vérifié à distance ; la réconciliation n'autorise pas une nouvelle feature. Pas de dépendance à la fin de TASK-0005 ni à la fusion VPS pour cette documentation indépendante.

Contrats : [AGENTS](../../AGENTS.md), [ROADMAP](../../ROADMAP.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [ADR-0028](../../docs/decisions/ADR-0028-v1-prototype-functional-gate.md), commandes/ordre du README. Risque : mauvaise sélection ou preuve sur mauvaise révision. Aucun runtime, UI, schéma partagé ou migration modifié.

Rôles : responsable/exécutant Codex, contextes Codex distincts pour référence historique et revue. Modèle/effort observés : `gpt-6-astra` / `ultra`, hérités pour les enfants natifs. Aucun changement de fournisseur ou modèle. Un propriétaire d'écriture du worktree ; reviewers en lecture seule. Aucun port/service requis.

Budget financier : unknown (tarif/consommation complète indisponibles). Réévaluation après deux échecs sans nouvelle information ou extension du périmètre ; gates maintenus. Mise en place comptée séparément des six tâches produit.

## Acceptation

1. AGENTS impose full Codex, état courant/workflow, responsabilité et revue indépendante sans affaiblir les anciens contrôles.
2. CURRENT distingue TASK-0124 acceptée, mise en place, PR VPS/infra et états historiques, sources datées. Aucun successeur produit choisi.
3. Brief/validation utilisables par copie : dépendances, périmètre, risques, commandes, source/environnement, résultats/retries, limites et rollback.
4. Workflow : checkout figé, qualité sérialisée, feedback ciblé puis gates finaux, revue indépendante et réévaluation des échecs répétés.
5. Pilote : six entrées non sélectionnées, référence qualifiée, définitions, coûts de coordination et critères conjoints ; pas d'économie fictive.
6. Un Codex indépendant peut reprendre depuis les documents, nommer la prochaine action et refuser preuve périmée, vert après retry ou contradiction historique.
7. Liens/diff vérifiés, test existant des contrats workspace et secrets exécutés ; CI source/main conservée avant acceptation finale.

## Plan et validation

1. Réconcilier TASK-0124 et isoler la branche depuis main.
2. Ajouter état courant, workflow, modèles, pilote et références d'entrée.
3. Exercer la passation avec Codex distinct, corriger les défauts et vérifier liens/diff, contrats/secrets.
4. Préparer une PR avec plan et [preuves](../../docs/validation/TASK-0125.md) ; conserver gates source/main et blocages réels.

Documents seuls : lint/types/build/UI ne ciblent aucun package modifié ; aucune réussite applicative inférée. CI imposée et inchangée. Un blocage upstream reste un blocage, sans affaiblissement ni appropriation du correctif d'une autre voie.

## Exploitation et rollback

Pas de processus, cron, API, abonnement, secret, donnée réelle ou contrôle d'admission ajouté. Observabilité par preuves et mesures du pilote, sans backend. Revert ciblé des ajouts, conservation des observations/checkpoints ; aucune ressource d'autre chantier touchée. DoD finale en attente de la livraison requise.
