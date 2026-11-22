# TASK-0137 — Résultat du pilote de 100 annonces avec Camofox gardé

## Périmètre et exécution

**Date :** 22 novembre 2026. **Demande :** tester avec 100 annonces après le succès de trois lectures sur [run 45074128865](https://github.com/CleMeY15/auto-world/actions/runs/45074128865).

**Exécution réelle :** [GitHub Actions 45076524445](https://github.com/CleMeY15/auto-world/actions/runs/45076524445), commit `b01d950e7ce0d7dc7c7f919aaf54a8db46df4604`, workflow one-shot `.github/workflows/leboncoin-camofox-session100.yml`, job 137374860130 **SUCCESS**. La réussite du job indique que le protocole a été exécuté et les preuves conservées, pas que les 100 annonces ont été lues.

Le run réutilise Camofox 1.19.0, Camoufox Firefox 152.0.4-beta.30, Ubuntu 22.04, trois URL de départ déjà connues et les recommandations effectivement observées. Une seule session temporaire gardée, aucun compte connecté, cookie importé, proxy ou interaction CAPTCHA. Cent annonces distinctes au maximum ; dix secondes minimum entre les navigations, sans retry ; arrêt au premier refus, contrôle obstruant ou erreur. Aucune écriture PostgreSQL ni déclencheur récurrent.

## Mesures observées

| Indicateur | Résultat |
| --- | ---: |
| Candidats distincts découverts | 13 |
| Fiches ouvertes | 2 |
| Documents principaux HTTP 200 | 2 |
| Fiches complètes et normalisées | **1** |
| Fiches rejetées | 1 |
| Fiches partielles | 0 |
| Refus HTTP 403/429 sur les documents principaux | 0 |
| Signaux de contrôle détectés | 1 |
| Arrêt du lot | `verification_obstructing` |
| Statut du lot | `stopped` |
| Progrès vers 100 | **1/100** |
| Continuité de session locale | 4/4 contrôles positifs |
| Perte de session observée | Non |
| Onglet de garde / nettoyage | Fermeture confirmée |
| Processus suivis | 10 ; restant : 0 |
| Annonces dans la base de préparation du runner | 1 |
| Nouvelle insertion dans PostgreSQL du VPS | **0** |

La première fiche : ouverture 22:14:53.404–22:14:56.344 UTC, document 200, `listing_observed`, champs centraux exploitables. La deuxième : ouverture 22:15:06.355–22:15:09.001 UTC, document principal 200, mais un contrôle obstruant l'affichage de la fiche, donc `verification_obstructing` et `core_fields_observed=false`. Écart mesuré à la deuxième : **10 011 ms** depuis la fin de la précédente. Heure de clôture 22:15:09.010 UTC ; durée totale **15,606 secondes**.

La garde locale a été créée une seule fois et contrôlée avant et après chacune des deux ouvertures : aucun échec sur quatre vérifications, aucune recréation. L'arrêt n'est donc pas attribuable à une perte de cette garde dans ce run. Le HTML de réponse peut porter HTTP 200 même lorsque la page est inexploitable. Le contenu interne du cadre et la règle interne DataDome ayant mené à son affichage ne sont pas établis.

## Validation et conservation

- **118 tests Node PASS**, 0 échec ; **19 tests Python PASS** dans le job, y compris le stockage idempotent.
- Préparation SQLite sur le runner : `sqlite_integrity=ok`, 1 annonce distincte, 1 observation. Un import SQL a été généré, **non exécuté** sur le VPS.
- Artefact Actions `leboncoin-session100-evidence` (ID **14774334919**) : résumé, reçus et captures scellées, reçu de préparation. Rétention limitée à 7 jours.
- Aucune fusion de PR, nouvelle source produit, modification du site ni nouvelle donnée ajoutée à la base privée existante. Les **22 annonces précédemment importées** restent le dernier volume PostgreSQL vérifié.

## Interprétation et suites

Le pilote précédent [3/3](https://github.com/CleMeY15/auto-world/actions/runs/45074128865) a montré un accès réussi lors d'une courte campagne, mais le présent pilote n'observe **qu'une** fiche valide avant un contrôle obstruant la deuxième. Les deux expériences ne suffisent pas à attribuer la différence à une cadence, une réputation réseau ou un score DataDome particulier. Le nombre réel de sous-requêtes déclenchées par les pages n'a pas été mesuré ; seuls les débuts de navigation sont espacés.

**Conclusion : la correction de continuité fonctionne ici, l'accès à la source reste non fiable.** Ne pas convertir le job vert, les 13 candidats ou le document HTTP 200 de la seconde fiche en annonces extraites. Pas de relance automatique après ce contrôle. Tester d'abord d'autres facteurs avec des preuves discriminantes et ne pas activer de collecte exhaustive en production tant que l'accès n'est pas qualifié.

État : `IN_PROGRESS / HUNDRED_TARGET_NOT_REACHED / SOURCE_ACCESS_UNRELIABLE`.
