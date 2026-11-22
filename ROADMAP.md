## Pilote 100 Camofox — arrêt au deuxième accès, session intacte

22 novembre 2026, [TASK-0137](roadmap/tasks/TASK-0137-leboncoin-autonomous.md), [run 45076524445](https://github.com/CleMeY15/auto-world/actions/runs/45076524445) : sur 100 fiches maximum prévues, **2 tentées / 1 complète**, deuxième fiche HTTP 200 mais contrôle de vérification réellement obstruant. Arrêt immédiat `verification_obstructing`, sans retry, 13 candidats détectés. La garde de session est valide sur 4/4 contrôles, donc pas de perte du contexte observée. [Bilan et limites](docs/validation/TASK-0137-session100.md). Les 22 fiches déjà importées dans PostgreSQL restent intactes ; ce nouveau run ne modifie pas le VPS. Accès stable et 100 annonces non prouvés ; TASK-0137 reste IN_PROGRESS.

# ROADMAP MASTER — Auto World Search

## Diagnostic d'accès — continuité du contexte navigateur

22 novembre 2026, [TASK-0137](roadmap/tasks/TASK-0137-leboncoin-autonomous.md) : l'audit du Camofox épinglé révèle que fermer le dernier onglet peut laisser son nettoyage périodique détruire la session entre deux fiches. Une voie séparée avec garde locale de continuité passe 117 tests hors réseau et le lint ; [analyse et portée](docs/validation/TASK-0137-session-continuity.md). Ce mécanisme ne démontre pas la cause du 403, ni une collecte régulière ou exhaustive. Les 22 annonces importées restent le dernier résultat réel.

## Lot réel leboncoin — 22 annonces insérées dans PostgreSQL

22 novembre 2026, [TASK-0137](roadmap/tasks/TASK-0137-leboncoin-autonomous.md), [PR270](https://github.com/CleMeY15/auto-world/pull/270) : le lot direct a extrait 22 annonces distinctes avec HTTP 200. Après correction d'une attente interrompue à 9 999 ms, la reprise reçoit HTTP 403 dès sa première fiche et n'ajoute rien. Le lot valide est maintenant inséré dans la base privée du projet ; une nouvelle connexion après écriture confirme 22 annonces distinctes. La publication du [reçu d'import](docs/validation/evidence/TASK-0137-project-import-receipt.json) et des métadonnées techniques de la cible a été explicitement autorisée par l'utilisateur. [Exécutions, import et limites](docs/validation/TASK-0137-batch100.md). Objectif de 100 non atteint ; collecte régulière et couverture catalogue non démontrées. Le catalogue du site et le registre source restent inchangés. TASK-0137 demeure IN_PROGRESS. Les checkpoints suivants sont historiques.

## Pilote Camofox — deux annonces relues, contrôle non résolu

22 novembre 2026, [TASK-0137](roadmap/tasks/TASK-0137-leboncoin-autonomous.md), [PR270](https://github.com/CleMeY15/auto-world/pull/270) : deux campagnes réelles ont chacune obtenu les données de deux annonces avec des goto initiaux HTTP 200. Valeurs comparées identiques à environ douze minutes d'écart. Chaque campagne s'arrête à la deuxième fiche sur un cadre de vérification détecté ; celui-ci persiste après l'attente passive de 5 002 ms de la seconde campagne, sans disparition des champs automobiles. Troisième annonce et secondes passes non atteintes. [Bilan, preuves et limites](docs/validation/TASK-0137-camofox-pilot.md). IN_PROGRESS / REPEAT_PENDING ; aucune collecte continue, source ou base produit activée. Les checkpoints plus bas sont historiques. Le pilote ChatGPT antérieur reste désactivé.

## Essai Camofox — accès ponctuel confirmé le 22 novembre 2026

[TASK-0137](roadmap/tasks/TASK-0137-leboncoin-autonomous.md), [PR270](https://github.com/CleMeY15/auto-world/pull/270) : le [run Camofox 45048184974](https://github.com/CleMeY15/auto-world/actions/runs/45048184974), source 1821670e, reçoit HTTP 200 et observe la même annonce Porsche 911 (2021, 23 000 km, 146 990 EUR). Champs centraux extraits et preuves relues. Le reçu automatique reste partiel à cause du snapshot général tronqué ; le DOM structuré confirme les données. [Preuves et portée](docs/validation/TASK-0137-camofox.md). État : OWN_ACCESS_OBSERVED_ONCE / REPEAT_PENDING. Aucune collecte régulière, activation de source ou intégration en base n'est déduite. La piste email reste en pause ; les essais Chromium précédents gardent leurs résultats historiques.

## Collecte autonome demandée — 22 novembre 2026

[TASK-0137](roadmap/tasks/TASK-0137-leboncoin-autonomous.md), [PR270](https://github.com/CleMeY15/auto-world/pull/270) : le navigateur propre démarre sur Linux, mais la première navigation reçoit HTTP 403. Zéro extraction, arrêt sans deuxième passage. [État et preuves](docs/validation/TASK-0137.md). Une nouvelle lecture cloud a réussi séparément ; elle ne qualifie pas le worker indépendant. Le pilote horaire ChatGPT préexistant reste un essai distinct, avec premier lancement programmé à vérifier. L'accès propre durable et la couverture du catalogue restent ouverts.

## Priorité : essai leboncoin avant extension du produit

[TASK-0136](roadmap/tasks/TASK-0136-leboncoin-feasibility.md), [PR269](https://github.com/CleMeY15/auto-world/pull/269) en brouillon : trois observations réelles obtenues dans le navigateur cloud et normalisées. Le GET HTTP direct est refusé ; le programme autonome est bloqué avant navigation par l'environnement local. La faisabilité durable reste ouverte. [Compte rendu précis](docs/validation/TASK-0136.md). Vérifier ce programme dans l'environnement de déploiement avant de poursuivre le développement général.

## Collecte propre à AutoFindex — 22 novembre 2026

[TASK-0135](roadmap/tasks/TASK-0135-owned-acquisition.md) ouvre, à la demande de l'utilisateur, une voie séparée pour notre moteur d'acquisition mondial et notre API. Première brique : capture HTTP bornée, conservation du contenu original, extraction automobile et historique via le SDK existant. [ADR-0036](docs/decisions/ADR-0036-owned-acquisition.md), [PR268](https://github.com/CleMeY15/auto-world/pull/268), [preuves](docs/validation/TASK-0135.md). La cible initiale est leboncoin ; aucune collecte réelle, permission de source ou couverture complète n'est établie par les tests sur serveur contrôlé. État : IN_PROGRESS, validation et revue de la branche séparée. Les autres voies et leurs qualifications conservent leur état.

TASK-0005, 18 November 2026: [PR252](https://github.com/CleMeY15/auto-world/pull/252)
accepted the PostgreSQL/Gosu capture plan on main `9bbf4d23`. The bounded
two-solve [implementation and validation](docs/validation/TASK-0005-postgres-gosu-material-capture.md#implementation-and-local-verification)
are ready for independent source review. Source/main native evidence and
protected delivery remain pending. TASK-0005/0005A stay IN_PROGRESS; PR251's
raw 159 blockers remain unwaived. The earlier checkpoints below are historical.

TASK-0005, 18 November 2026: [PR250's body checkpoint](https://github.com/CleMeY15/auto-world/pull/250)
accepts the Gosu diagnostic on main `0c2b3d6c1e67c665f7cd1718f18703baf673409e`.
The next [PostgreSQL/Gosu proposal](roadmap/plans/TASK-0005-postgres-gosu-material-capture.md)
is PLAN_REVIEWED / DOCUMENTATION_DELIVERY_PENDING, not selected execution.
TASK-0005/0005A remain IN_PROGRESS; raw243 on that main is unwaived.
Earlier Gosu delivery pending records are historical; full M3 closure, capacity,
retention, admission/support and final gates remain open.

TASK-0005 checkpoint, 17 November 2026: [PR247's final acceptance](https://github.com/CleMeY15/auto-world/pull/247#issuecomment-6964012598)
accepts observation delivery on main `73ad4eddec190f3d6928f41f86c3e33858598683`.
All five main workflows and independent original-evidence reviews pass. The
scanner material-retention row is closed; physical C:/NTFS execution remains
on f630339b, without a new copy or restoration. TASK-0005/0005A stay IN_PROGRESS:
complete service/source/database retention, binary equivalence, admission/support
and final gates remain open; 243 upstream blockers remain unwaived. Continue with
the [M3 material inventory](docs/validation/TASK-0005-managed-m3-preparation.md).
Earlier pending checkpoints below are historical.

TASK-0005 NexusLite checkpoint, 17 November2026 at16:55UTC: the
[actual C:/NTFS copy and manifest-first restoration](docs/validation/TASK-0005-nexus-observation.md)
are independently APPROVED on accepted mainf630339b (PR246): one invocation,
eight passed phases,50 members, retained pair and owned cleanup verified.
The localCopy/localRestore identity observations are in separate source/main
delivery; scanner material-row closure awaits that delivery. TASK-0005/0005A
remain IN_PROGRESS,243 blockers unwaived, admission/support and final gates open.
No further publisher or copy/restoration run. Earlier checkpoints are historical.

TASK-0005 NexusLite checkpoint, 17 November2026: publisher observation delivery
is accepted on main548630df ([PR245](https://github.com/CleMeY15/auto-world/pull/245)).
The real Windows copy attempt failed; no localCopy/localRestore acceptance.
Authenticated original-evidence review and fresh System32/WinSxS observations
support the [reviewed bounded tool-link correction](docs/validation/TASK-0005-windows-tool-links.md).
Local implementation and independent review pass; source/main delivery pending; no new publisher run. TASK-0005/0005A
stay IN_PROGRESS,243 blockers unwaived. Earlier pending checkpoints are historical.

## Point d'entrée courant — 17 novembre 2026

Lire [CURRENT](roadmap/CURRENT.md) pour la passation courte, ses sources et la prochaine action. Les checkpoints datés ci-dessous conservent leur état historique ; leurs intitulés « courant » ne remplacent pas un checkpoint final accepté plus récent.

TASK-0124 est `DONE_FOR_V1_PROTOTYPE` selon le [checkpoint final PR235](https://github.com/CleMeY15/auto-world/pull/235#issuecomment-6745769896), vérifié le 16 novembre : main `f554c475b6748fb1b53281985588fab287c811ed`. Ce constat ne valide pas les révisions ultérieures du dépôt.

À la demande de l'utilisateur, [TASK-0125 — fonctionnement full Codex](roadmap/tasks/TASK-0125-full-codex-workflow.md) installe le mode opératoire et prépare un pilote de six tâches produit admissibles. C'est une tâche de processus distincte, sans nouveau parcours produit, fournisseur, service ou modification des gates. Sa propre livraison reste à vérifier. Les voies VPS et TASK-0005 gardent leurs propriétaires et leurs validations séparées.

TASK-0005 publication checkpoint, 17 November 2026: [actual recovery publication44009258503 and original-evidence review](docs/validation/TASK-0005-publisher-observation.md) pass all14 phases, authenticated readback and cleanup. The eleven-field publisher observation is being delivered separately; no real NexusLite copy/restoration or admission is established. Original failed run43988267108 and UNKNOWN cleanup remain historical; TASK-0005/0005A stay IN_PROGRESS and243 upstream blockers remain unwaived.

TASK-0005 checkpoint, 17 November 2026: the [reviewed publisher inventory/transport correction and bounded recovery](docs/validation/TASK-0005-publisher-inventory-recovery.md) pass final local verification and independent source review; source/main delivery and the new publication remain pending. Original run43988267108 stays FAILED before push, cleanup UNKNOWN, with no accepted publisher tuple. TASK-0005/0005A remain IN_PROGRESS;243 upstream blockers and real NexusLite copy/restoration remain open. Earlier checkpoints below retain their historical scope.

## Checkpoint courant — TASK-0123, 9 novembre 2026

TASK-0122 est `DONE_FOR_V1_PROTOTYPE` sur main `43d3943dced0dc249fba0df49c5749426912e080`, par [PR233 et son checkpoint accepté](https://github.com/CleMeY15/auto-world/pull/233#issuecomment-6740879403). Les quatre validations source/main passent :608 tests navigateur réussis,10 exclusions préexistantes,10 phases persistantes sur deux moteurs ; revue finale indépendante PASS. Les états pending plus anciens sont historiques.

[TASK-0123 — critères enregistrés à la demande](roadmap/tasks/TASK-0123-saved-search-criteria.md) est `IN_PROGRESS`, DoR satisfaite, sur une branche dédiée. Alléger Mes listes avec le composant natif de dépliage existant, sans modifier les critères ni masquer les avertissements. Pas de nouvelle dépendance ni d'infrastructure. Aucune tâche suivante avant son acceptation complète.

Checkpoint local TASK-0123 : `LOCAL_VALIDATED / DELIVERY_PENDING`, qualité Linux et634 tests navigateur réussis (10 exclusions préexistantes), revues indépendantes code et20 captures approuvées. [Preuves et réparation visuelle à200%](docs/validation/TASK-0123.md). Les validations GitHub de la source finale et du main, dont le parcours persistant réel, restent requises.

## Point courant — 9 novembre 2026

Checkpoint TASK-0121 : `LOCAL_TARGET_VALIDATED / DELIVERY_PENDING`,136 tests unitaires web et44 nouveaux scénarios navigateur réussis, qualité locale et revues source/pixels favorables. [Preuves et limites](docs/validation/TASK-0121.md). Suite navigateur complète, parcours persistant réel et acceptation GitHub/main encore requis.

TASK-0120 est `DONE_FOR_V1_PROTOTYPE` sur main `37a6e5ea90a8469491b295b97a41a4a671b587a7`, par [PR231 et son checkpoint accepté](https://github.com/CleMeY15/auto-world/pull/231#issuecomment-6736705415). Les points pré-livraison ci-dessous restent historiques. Incrément suivant : [TASK-0121 — retirer un critère appliqué](roadmap/tasks/TASK-0121-refine-search.md), `IN_PROGRESS`, DoR et revues de plan validées. Réutiliser le formulaire existant, sans recherche automatique, avec annulation bornée ; aucun backend ni nouvelle dépendance. TASK-0005 et ses contrôles restent dans l'autre branche. Aucune tâche suivante avant livraison validée de ce lot.

## Priorité active — prototype V1, 5 novembre 2026

L'utilisateur demande de développer un bon prototype V1 fonctionnel avant de reprendre la sécurité restante de TASK-0005. [ADR-0028](docs/decisions/ADR-0028-v1-prototype-functional-gate.md) remplace le blocage de développement : le [jalon fonctionnel accepté de PR222](https://github.com/CleMeY15/auto-world/pull/222#issuecomment-6656692551), dont les17 phases réelles passent sur main39521a7f, suffit comme dépendance infrastructure **pour le prototype isolé à données fictives**. L'amendement est livré par [PR223 et son checkpoint](https://github.com/CleMeY15/auto-world/pull/223#issuecomment-6657834017), sur main `b785f432` ; cette acceptation ne valide pas les modifications ultérieures.

Prochaine chaîne : TASK-0104 (stockage PostgreSQL), puis TASK-0105 (index/recherche/API), puis TASK-0106 (reprise de l'application). Chaque prédécesseur doit être réellement livré dans ce périmètre avant le suivant. Les autres dépendances, la DoR, les tests fonctionnels, la qualité UI/UX et les protections essentielles restent exigés. TASK-0005A et la qualification sécurité/admission de TASK-0005 sont différées jusqu'à la V1 utilisable ; elles ne sont ni validées ni un motif pour relancer les scanners pendant le développement du prototype. Production, publication publique et données réelles restent interdites avant leur qualification distincte.

Les points de suivi datés ci-dessous sont conservés comme historiques ; leurs anciens blocages TASK-0104–0106 sont remplacés uniquement pour cette voie prototype.

TASK-0104 est `DONE_FOR_V1_PROTOTYPE` sur main `87e873276b92c83b50dbb1f1e07c2aafd62f5cea`, par [PR224 et son checkpoint final](https://github.com/CleMeY15/auto-world/pull/224#issuecomment-6662552697) : stockage transactionnel PostgreSQL avec le pilote standard `pg`, sans ORM ni nouvel orchestrateur. [Les preuves de validation](docs/validation/TASK-0104.md) conservent le détail des contrôles.

TASK-0105 est `DONE_FOR_V1_PROTOTYPE` sur main `2e37541427cc2e8a871822c613d4c05272412daa`, par [PR226 et son checkpoint final](https://github.com/CleMeY15/auto-world/pull/226#issuecomment-6666281417). Le plafond incohérent du scénario massif de PR225 a été corrigé sans retirer de contrôle. La qualité et les quinze phases PostgreSQL/OpenSearch passent sur cette révision exacte ; [les preuves historiques](docs/validation/TASK-0105.md) restent conservées.

TASK-0106 est `DONE_FOR_V1_PROTOTYPE` sur main `6a37b3da28a4b5f8dc10100c8e0808baaf6f1f5a`, par [PR227 et son checkpoint final](https://github.com/CleMeY15/auto-world/pull/227#issuecomment-6669154748). La composition, la reprise et la restauration ont été validées ; [les preuves historiques](docs/validation/TASK-0106.md) restent conservées. Cette acceptation ne termine pas tout le site V1 et ne relance pas la qualification TASK-0005.

Incrément actif, 8 novembre 2026 : [TASK-0119 — interface du prototype persistant](roadmap/tasks/TASK-0119-persistent-web-prototype.md), `IN_PROGRESS` sur `codex/task-0119-persistent-web-prototype`. Réutiliser l'interface V2 existante avec le stockage PostgreSQL et l'index OpenSearch, données fictives uniquement ; conserver les descriptions et leur provenance, isoler le mode et les listes locales, prouver les parcours et le redémarrage réels. [ADR-0032](docs/decisions/ADR-0032-persistent-web-prototype.md). L'autre branche et l'aperçu3100 restent intacts. Aucune nouvelle tâche après ce lot avant sa livraison validée.

Checkpoint local TASK-0119, 8 novembre : `LOCAL_VALIDATED / DELIVERY_PENDING`, parcours persistants9/9 et compatibilité V1 sur services réels15/15,518 tests navigateur réussis (10 exclusions préexistantes), qualité et revues indépendantes validées. [Preuves et limites](docs/validation/TASK-0119.md). Cela ne remplace pas l'acceptation de la PR et du main protégé.

Checkpoint main, 9 novembre : PR228 fusionnée normalement, cinq validations d'intégration réussies. Un contrôle de réactivité de la comparaison dépasse100ms ; correction ciblée dans [PR229](https://github.com/CleMeY15/auto-world/pull/229), sans relever le seuil ni retirer de contrôles. Correction validée localement : qualité Linux native,520 tests navigateur réussis (10 exclusions existantes), ouverture locale maximale31.1ms/100ms, revues indépendantes favorables. Le parcours persistant GitHub de PR229 passe9/9 ; un ancien test à deux horloges a ensuite été stabilisé, avec régression déterministe, toutes ses assertions conservées et nouvelle qualité locale réussie. TASK-0119 reste `IN_PROGRESS` jusqu'à acceptation GitHub/main de cette correction ; aucune tâche suivante engagée.

## North Star

Point courant, 9 novembre 2026 : TASK-0119 est `DONE_FOR_V1_PROTOTYPE` sur main `293a218c0750ee693ad1c426e91629816cfa238d`, par [PR229 et son checkpoint accepté](https://github.com/CleMeY15/auto-world/pull/229#issuecomment-6730265143). Les états pré-livraison ci-dessus sont conservés comme historiques. Incrément autorisé suivant : [TASK-0120 — recherche par mots](roadmap/tasks/TASK-0120-keyword-search.md), `IN_PROGRESS`, sur une branche dédiée. Réutiliser les marques/modèles fictifs et le moteur existants, conserver sauvegardes/liens/qualité UI, sans nouvelle dépendance ni collecte. TASK-0005 reste une qualification distincte dans l'autre chat ; aucune admission n'est déduite de cette progression produit.

Checkpoint local TASK-0120, 9 novembre : `LOCAL_VALIDATED / DELIVERY_PENDING`. Recherche par mots implémentée, qualité Linux native et532 scénarios navigateur réussis (10 exclusions préexistantes), revues indépendantes code/architecture/pixels favorables. [Preuves](docs/validation/TASK-0120.md). Restent l'intégration persistante réelle et l'acceptation GitHub/main ; aucune tâche suivante engagée.

Dernier incrément produit livré : [TASK-0114 — accès guidé au simulateur officiel de carte grise](roadmap/tasks/TASK-0114-official-registration-guide.md), DONE_ON_MAIN par [PR190 et son checkpoint final](https://github.com/CleMeY15/auto-world/pull/190#issuecomment-6352642818), le 23 octobre 2026 (Europe/Paris). Une page statique prépare l'utilisateur puis ouvre explicitement le simulateur Service Public ; aucun moteur fiscal ni collecte de données n'est recréé. [CI de la tête de PR](https://github.com/CleMeY15/auto-world/actions/runs/39857059485) et [CI du main fusionné, tentative 2](https://github.com/CleMeY15/auto-world/actions/runs/39859732751/attempts/2) SUCCESS : 375 tests navigateur réussis et 7 exclusions préexistantes par run, sans échec ni retry de test rapporté. La tentative 1 du main reste CANCELLED pendant l'installation des dépendances navigateur ; sa preuve est conservée. Revues indépendantes et identités exactes figurent dans [le registre de livraison](roadmap/DELIVERY.md).

Ce suivi consigne la livraison acceptée de TASK-0114, pas la validation d'une modification documentaire ultérieure. Les fiches de tâche et de validation conservent leur état historique pré-livraison ; le checkpoint final fait foi pour l'acceptation. TASK-0005/0005A restent IN_PROGRESS et TASK-0104 à TASK-0106 restent bloquées. Aucune infrastructure ni source réelle n'est admise ; aucune nouvelle tâche fonctionnelle n'est sélectionnée par cette mise à jour.

Construire le moteur de recherche et d'intelligence automobile mondial le plus rapide, complet et utile à la décision : une recherche unique multi-pays/multi-sources, web+iOS+Android, langage naturel, historique véhicule, scoring d'affaires et de confiance, coût rendu/immatriculé en France, alertes et données B2B.

Incrément produit en cours, mis à jour le 24 octobre 2026 : [TASK-0115 — guide acheteur vers HistoVec](roadmap/tasks/TASK-0115-official-history-guide.md), IN_PROGRESS / LINUX_VALIDATION_PENDING. Une page d'orientation vers le service officiel, sans récupération de rapport ni données véhicule, conformément à [ADR-0025](docs/decisions/ADR-0025-official-history-guide.md). Les18 nouveaux cas navigateur et les autres gates locaux passent ; un dépassement de performance de la comparaison sous Windows, également reproduit sur le main accepté propre, reste explicitement consigné. L'amendement revu séquentiellement par Architect puis Critic autorise la publication d'une PR, pas une validation locale complète : CI Linux source et main complètes, sans échec ni retry, et revue visuelle indépendante restent exigées. Ce choix ne débloque aucune tâche infrastructure ou source réelle.

Le produit ne doit pas seulement aider à trouver une annonce. Il doit aider à trouver, comprendre, vérifier, comparer, importer et acheter le bon véhicule.

L'expérience utilisateur doit être un avantage concurrentiel majeur : interface premium, extrêmement fluide, très épurée et simple à comprendre au premier regard, tout en restant complète pour les utilisateurs avancés. La référence est le niveau de clarté, cohérence, finition, fluidité et simplicité associé aux meilleurs produits Apple — sans copier leurs assets, branding ou écrans.

## Strategic Moats — actifs à construire dès le début
1. Vehicle Graph : l'entité véhicule est distincte des annonces et conserve ses observations successives.
2. Vehicle Knowledge Graph : taxonomie versionnée marques/modèles/générations/versions/moteurs/options/codes constructeurs.
3. Historical Market Graph : first_seen/last_seen, prix, kilométrages, vendeurs, pays, réapparitions et changements de source.
4. Provenance Graph : chaque donnée critique possède source, observed_at, méthode et niveau de confiance.
5. Golden Datasets : corpus vérifiés pour normalisation, déduplication, pricing, VIN, specs et IA.
6. Direct Supply Network : API/feeds directs concessionnaires et partenaires afin de réduire progressivement la dépendance aux marketplaces.
7. Market Intelligence : comparables, liquidité, décote, temps de vente, indices pays/modèles et produits B2B.

## Principes non négociables
- Mobile-first, API-first, event-driven lorsque pertinent.
- UI/UX premium first-class ; jamais repoussée au polish final.
- Design system partagé web/mobile avant prolifération des écrans.
- Simplicité apparente + puissance progressive.
- Navigation courte, cohérente et prévisible.
- États loading/skeleton/empty/error/offline/success conçus explicitement.
- Validation visuelle/UX, accessibilité et performance perçue obligatoires avant Done.
- VehicleEntity != Listing : ne jamais modéliser le produit comme une simple table d'annonces.
- Provenance obligatoire pour chaque champ critique.
- Valeurs contradictoires conservées comme observations ; aucune écrasée silencieusement.
- Raw payloads immuables + données canoniques versionnées et rejouables.
- Connecteurs isolés ; une panne source ne casse pas la plateforme.
- Déduplication probabiliste mais explicable.
- IA hors du chemin critique lorsqu'une règle déterministe suffit.
- LLM interdit comme source d'une donnée fiscale, VIN, technique, pollution, prix ou historique non vérifiée.
- Recherche cible <500 ms p95 hors génération IA.
- Aucune source sans statut d'usage documenté.
- Feature flags pour fonctionnalités risquées.
- Internationalisation structurelle dès le schéma : langues, monnaies, km/miles, kW/ch, conduite, fiscalité, normes.

## Vehicle Intelligence Layer
Chaque annonce doit progressivement résoudre vers :
Listing -> VehicleEntity -> Identity/VIN -> Specs -> Emissions -> History -> Provenance -> Trust -> Market Value -> Deal Score -> Registration/Import -> Total Cost.

### VIN & Identity Resolver
- VIN lorsqu'il est légalement/contractuellement disponible ; sinon résolution marque/modèle/génération/version/moteur/année.
- décodage VIN via sources autorisées et données constructeurs/partenaires ;
- contrôle de cohérence VIN vs annonce ;
- conservation du niveau de confiance ;
- jamais inventer un VIN ou une caractéristique absente.

### Vehicle History Gateway
Architecture multi-fournisseurs : Histovec lorsque le parcours et l'éligibilité le permettent, CarVertical ou autres partenaires commerciaux si intégration/affiliation autorisée, bases partenaires/constructeurs et notre propre historique d'observation. Si aucune API/licence ne permet d'afficher les données, l'UI route explicitement l'utilisateur vers le fournisseur au lieu de prétendre posséder le rapport.

### Specs & Emissions Resolver
Résoudre avec provenance : puissance kW/ch, cylindrée, énergie, transmission, masse, norme Euro, CO2 WLTP/NEDC selon contexte, consommation, autonomie électrique, puissance fiscale lorsque connue/calculable, caractéristiques utiles à l'immatriculation/import. Priorité aux sources officielles/licenciées et au VIN ; fallback modèle/version avec confiance affichée.

### French Registration Engine
Moteur versionné par date et règles officielles permettant d'estimer le coût d'immatriculation français avec le minimum de saisie utilisateur. Les paramètres régionaux, énergie, puissance fiscale, âge/date de première immatriculation, émissions, exonérations/réductions et taxes applicables sont des règles versionnées avec source et effective_from/effective_to. Le calcul doit distinguer véhicule déjà immatriculé en France, import UE/EEE et import hors UE. Les estimations doivent exposer hypothèses et incertitude.

### Landed Cost / Total Acquisition Cost
Pour les imports : prix converti, transport/logistique, assurance transport si applicable, droits/taxes applicables selon origine et preuve d'origine, TVA lorsque applicable, homologation/RTI/COC selon cas, fiscalité environnementale applicable, immatriculation et autres frais documentés. Chaque poste est séparé, versionné et explicable. Ne jamais afficher un faux total précis lorsqu'une donnée obligatoire manque.

### Trust Score
Score distinct du Deal Score : incohérences VIN/specs/km/prix, photos réutilisées, anomalies historiques, contradictions entre sources, vendeur/source, données manquantes. Le score doit être explicable et ne jamais présenter une suspicion algorithmique comme un fait établi.

### Deal Score & Pricing
Valeur marché + intervalle de confiance + comparables + impact km/âge/options/pays + liquidité + historique de prix. Aucun score si la confiance minimale n'est pas atteinte.

### Computer Vision
Détection assistée depuis photos : couleur, carrosserie, jantes, certains équipements visibles, doublons via perceptual hash et anomalies évidentes. Les inférences CV sont marquées comme telles et ne remplacent pas une donnée certifiée.

## AI Buying Agent
L'IA devient un agent d'aide à l'achat outillé : comprendre une recherche naturelle, appeler Search/Compare/History/Pricing/Registration/Import/SaveSearch, expliquer les résultats et surveiller une recherche. Les outils déterministes et bases restent autoritaires. Toute affirmation importante doit être traçable vers les données.

## Expérience produit cible
- Search : langage naturel + filtres progressifs.
- Explore : filtres experts, carte et zones géographiques/rayons.
- Deals : opportunités fondées sur Pricing + confiance.
- Vehicle Detail : photos d'abord, informations décisionnelles ensuite.
- Verify : historique externe/interne, VIN, provenance et Trust Score.
- France Cost : carte grise et coût rendu/immatriculé.
- Compare : 3-5 véhicules, différences automatiquement mises en évidence + explication IA.
- Watch : alertes nouvelles annonces, baisse de prix, deal détecté.
- Garage : favoris, comparaisons, recherches sauvegardées.
- Share : liens propres vers véhicule/comparaison/recherche pour acquisition organique.

## Platform capabilities supplémentaires
- Search géographique mondiale : rayon, pays inclus/exclus, distance vendeur et transport estimé.
- Source Registry opérationnel avec health score, volume, droits, fraîcheur, couverture, erreurs et coût.
- Internal Ops Console pour inspecter ingestion, mapping, dedup, provenance, anomalies, pricing et incidents.
- Feedback loop utilisateur : signaler mauvaise version, doublon, option ou information ; corrections auditables vers golden datasets.
- Event model : listing.created/updated/removed, price.changed, mileage.changed, vehicle.matched, history.updated, deal.detected, trust.changed.
- Market indices : prix, décote, liquidité, jours en stock, pays les moins chers, évolution temporelle.

## Stack de référence
Web: Next.js + TypeScript. Mobile: React Native/Expo. Backend: TypeScript/Fastify ou NestJS; Python pour ML/data si utile. PostgreSQL, OpenSearch, Redis, S3-compatible, queues/events, Terraform, GitHub Actions, OpenTelemetry.

## Direction UI/UX
Le produit doit paraître simple même lorsqu'il orchestre des millions d'annonces et des dizaines de filtres. Grandes surfaces respirantes, hiérarchie typographique nette, animations utiles et courtes, cartes lisibles en <2 secondes, photos mises en valeur, conventions natives iOS/Android, dark mode, aucune UI d'administration brute exposée au client. Contrat : `docs/PRODUCT_UX.md`.

## Macro-phases
### P0 — Fondation
Architecture, repo/CI, contrats, VehicleEntity/Listing/Observation, provenance, taxonomie v1, Source Registry, event vocabulary, threat model, UX/design foundation, règles de versioning fiscal.
### P1 — Vertical Slice
D'abord une tranche de développement/CI sur données synthétiques explicitement étiquetées, sans images ni source réseau, puis 1-3 sources autorisées après leurs gates de droits et d'infrastructure : ingestion -> raw -> normalisation -> VehicleEntity -> provenance -> index -> API -> UI premium -> favoris. La preuve synthétique ne vaut ni admission des quatre services ni autorisation d'une source réelle. Historique d'observation dès ce stade.
### P2 — MVP France/Allemagne/Corée
10-20 sources, web+app, comptes, alertes, dedup v1, historique prix, recherche IA v1, VIN/specs v1, emissions v1, registration France v1 et routing historique externe.
### P3 — Product Market Fit
Pricing/Deal Score, Trust Score, import/landed cost, compare, recommandations, computer vision ciblée, premium, analytics, UX optimization.
### P4 — Europe + Asie
50-100+ sources, millions d'annonces, dealer feeds, B2B alpha, Vehicle Graph enrichi, multi-fournisseurs history/specs.
### P5 — Global Platform
20M+ annonces uniques potentielles, API B2B, market indices/data products, internationalisation mondiale et réseau direct de fournisseurs.

## Workstreams
A Product/UX & Design System; B Data Acquisition/Connectors; C Vehicle Knowledge Graph & Canonical Data; D Search/Geo; E Dedup/Vehicle Graph; F AI/NLP/CV; G Pricing/Deal Score/Market Intelligence; H VIN/History/Trust; I Specs/Emissions; J French Registration & Import/Landed Cost; K Accounts/Alerts/Share; L Dealer/B2B; M Platform/DevOps/SRE/Ops Console; N Security/Privacy/Legal; O Analytics/Growth/Feedback/Evals.

## Dépendances structurantes
- AI Search dépend de taxonomy + Search API déterministe.
- Vehicle History dépend de contrats fournisseurs + identity resolver.
- Registration dépend de specs/emissions + règles officielles versionnées + localisation utilisateur.
- Import Cost dépend de provenance/origine + règles versionnées ; ne jamais confondre pays de vente et origine douanière.
- Trust dépend de provenance + identity + historique ; Deal Score reste séparé.
- Deal Score dépend de history + comparables + quality gates.
- Alerts dépend d'événements idempotents + requêtes canoniques sauvegardées.
- Computer Vision ne devient source autoritaire que pour des champs explicitement permis et avec confiance.
- Global rollout dépend du Source Registry + i18n + unités + monnaies + taxes.

## Quality Gates spécifiques
- Golden dataset de référence avant dédup probabiliste/IA/pricing en production.
- Toute règle fiscale : source officielle, date d'effet, tests de cas limites, version et audit trail.
- Toute donnée VIN/history/specs : licence/statut d'usage + provenance + confidence.
- Toute estimation import : détail par poste + hypothèses + date des règles.
- Toute feature utilisateur : revue UX/visuelle + accessibility + performance.
- Toute suspicion Trust : formulation non diffamatoire, explicable et contestable/corrigeable.

## Stop conditions
Stopper une intégration si droits incertains, usage interdit, instabilité chronique, coût injustifié ou qualité dangereuse. Ne jamais livrer : filtres LLM non validés, scraper monolithique, UI couplée aux sources, règle fiscale non versionnée, donnée VIN/spec/pollution inventée, rapport historique présenté comme vérifié sans source, ranking sponsorisé invisible, Deal/Trust Score non explicable ou UI brute considérée temporaire.

## Exécution
La source de vérité opérationnelle est `roadmap/`. Codex lit `AGENTS.md`, puis cette roadmap, puis l'epic actif. Une tâche READY au plus peut avancer dans chaque voie indépendante définie par [ADR-0012](docs/decisions/ADR-0012-synthetic-development-lane.md), amendé par [ADR-0028](docs/decisions/ADR-0028-v1-prototype-functional-gate.md) pour inclure le prototype synthétique avec conteneurs. Dans chaque voie, respecter l'ordre des dépendances ; un travail partagé exige coordination avant modification. TASK-0006 reste le plan synthétique accepté ; la qualification sécurité P0 de TASK-0005/0005A est différée et ne préempte pas la chaîne prototype TASK-0104→0105→0106. Les Strategic Moats doivent influencer les décisions d'architecture même lorsqu'une fonctionnalité correspondante n'est livrée que dans une phase ultérieure.

## Historique du suivi produit

Point de suivi du 22 octobre 2026, antérieur à la livraison de TASK-0114, conservé sans réécriture ; il ne représente pas l'état de livraison courant :

Incrément produit en cours : [TASK-0114 — accès guidé au simulateur officiel de carte grise](roadmap/tasks/TASK-0114-official-registration-guide.md), à la demande explicite de réutiliser Service Public. Une page statique prépare l'utilisateur puis ouvre le service officiel ; aucun moteur fiscal ni collecte de données n'est recréé. Le [correctif de dépendances PR189 est accepté sur main](https://github.com/CleMeY15/auto-world/pull/189#issuecomment-6351380809) et intégré. TASK0114 est LOCAL_VALIDATED / DELIVERY_PENDING : gates locaux complets,375 tests navigateur réussis/7 exclusions préexistantes et revue visuelle APPROVE ; la livraison finale tête de PR/main reste un gate distinct, consigné dans le checkpoint de sa PR. Ce point de suivi n'est pas une déclaration Done et ne modifie pas les dépendances infrastructure.

Dernier incrément produit livré : [TASK-0113 — liens de comparaison synthétique](roadmap/tasks/TASK-0113-synthetic-comparison-links.md), DONE_ON_MAIN par [PR184 et son checkpoint final](https://github.com/CleMeY15/auto-world/pull/184#issuecomment-6301516770), le 20 octobre 2026. [CI de la tête de PR](https://github.com/CleMeY15/auto-world/actions/runs/39493715293) et [CI du main fusionné](https://github.com/CleMeY15/auto-world/actions/runs/39495578353) SUCCESS : 361 tests navigateur réussis et 7 exclusions préexistantes par run, sans échec ni retry rapporté. Le lien local référence 2–3 publications de démonstration ; leur lecture actuelle reste explicite, sans données figées ni identité de véhicule réel. Les preuves exactes sont consignées dans [le registre de livraison](roadmap/DELIVERY.md). Cette livraison produit n'admet aucune infrastructure ni source réelle et ne débloque pas TASK-0104 à TASK-0106.

Point de suivi antérieur à la livraison de TASK-0113, conservé sans réécriture ; il ne représente pas l'état de livraison courant :

Incrément produit indépendant : [TASK-0112 — liens de publication synthétique](roadmap/tasks/TASK-0112-synthetic-publication-links.md), implémentation et validation locale approuvées (291 tests navigateur réussis par plateforme Windows/Linux), livraison finale soumise aux CI de la tête de PR puis du main protégé. TASK-0111 est livré par [PR180 et son checkpoint](https://github.com/CleMeY15/auto-world/pull/180#issuecomment-6251833551), CI du main39140493041 SUCCESS. Les liens de publication pointent vers la lecture actuelle de la démo locale, sans figer les données ni identifier un véhicule réel. Cette voie n'admet aucune infrastructure et ne débloque pas TASK-0104 à0106.

## Checkpoint courant — 9 novembre 2026, après TASK-0121

TASK-0121 est `DONE_FOR_V1_PROTOTYPE` sur main `7ea0d333babb74dd993aaf14684d4e10f4852e3f`, par [PR232 et son checkpoint accepté](https://github.com/CleMeY15/auto-world/pull/232#issuecomment-6738946552). Qualité et parcours persistant réussis sur source et main ;576 scénarios navigateur réussis,10 exclusions préexistantes. Les anciens états pending ci-dessus restent historiques.

[TASK-0122 — renommer une recherche enregistrée](roadmap/tasks/TASK-0122-rename-saved-searches.md) est `IN_PROGRESS`, DoR et revues Architect/Critic validées, sur une branche isolée. Réutiliser le mécanisme des comparaisons sans modifier les critères. Candidat suivant, seulement après acceptation0122 : présentation progressive des critères dans Mes listes. Aucune qualification TASK-0005 ni admission de données réelles n'est déduite de ces incréments.

## Checkpoint courant — 9 novembre 2026, après TASK-0123

Les points précédents restent historiques. TASK-0122 est acceptée par [PR233](https://github.com/CleMeY15/auto-world/pull/233#issuecomment-6740879403), et TASK-0123 est `DONE_FOR_V1_PROTOTYPE` sur main `79ccf8781a7c396b3dd590ee306a3aab5763aaf2`, [checkpoint final PR234](https://github.com/CleMeY15/auto-world/pull/234#issuecomment-6742762179). Qualité et parcours persistant réussis sur source/main ;634 tests navigateur réussis,10 exclusions préexistantes, aucun échec/retry.

[TASK-0124 — trier directement les résultats](roadmap/tasks/TASK-0124-results-sort.md) est `LOCAL_VALIDATED / DELIVERY_PENDING`, sur une branche isolée intégrant main `b4b17be` sans conflit. Tri déterministe existant avec soumission explicite, critères acceptés exacts et remise à zéro de pagination ;668 tests navigateur réussis/10 exclusions préexistantes, gates globaux intégrés et revues code/architecture/pixels favorables. La livraison source/main reste obligatoire, voir [les preuves](docs/validation/TASK-0124.md). Candidat suivant après acceptation seulement : navigation précédente/suivante dans les annonces déjà chargées. TASK-0005 reste une voie séparée ; aucune admission de données réelles n'est déduite de ce travail.

Voie produit du 18 novembre 2026 : [TASK-0126 — parcourir les annonces déjà chargées](roadmap/tasks/TASK-0126-loaded-listing-navigation.md) en validation, première entrée du pilote après acceptation de PR243. [Passation](roadmap/CURRENT.md).

Voie indépendante TASK-0130 (18 novembre 2026) : [préparation de l'accès web privé](roadmap/tasks/TASK-0130-private-web.md), activation réservée au parent après [gates](docs/operations/PRIVATE_WEB.md).
