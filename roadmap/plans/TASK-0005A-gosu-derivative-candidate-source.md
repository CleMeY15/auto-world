# TASK-0005A - Gosu derivative source candidate

Status: APPROVED_SOURCE_PLAN; implementation and source delivery pending. Image UNBUILT; no publication, runtime or admission authority.

Accepted prerequisites: preparation record PR168 is SOURCE_DONE_ON_MAIN at a6cd921ce9a8fe2858fd0bd0af9f6dbaf0401344/tree ea799002b831f7711f01872c193119b229578712, final CI38490647313/main CI38491904770 SUCCESS, independent delivery7294/SHA25693c232ca0684e1dac89aa9a56346d11ff910f0a474250015502ae1c7e305e316. The independent document projection7784/SHA25652161f387ff2d5243805a2ca6c6c91a43ec1accfea6b74a46afb1566d57a4733 accepts11 byte-equal document identities,30951 bytes, on the retained actual11 pair. Architecture plan19965/SHA256ff17bff30ac5fde2e3519d4b9dfc7c60d2cfacf5f21df78597863012e140d66c and distinct critic3784/SHA2562b86c0c61fe61a446f4423cf935dc5fba442d9aa6dd0e83c89c724943cb1dc90 are frozen. The943-file baseline203419/SHA256b9789904caffe7b2d6de0a0d90f42f3280891c33f007577847653f92fc672c3e precedes source edits. Those private local evidence identities do not claim public downloads or clean-clone availability.

The approved plan below preserves its earlier source observations. This increment starts from accepted main a6cd921c and keeps the seven PR168 record documents byte-identical except the three explicitly append-only ADR/index/DELIVERY paths. A source-only interface supplement will close the two pure modules before parallel implementation. Actual context/image proof remains a later phase.

# PostgreSQL — contrat source du candidat gosu dérivé

État : ARCHITECT_PLAN_REVIEW_PENDING / SOURCE_ONLY. Auteur : architecture indépendante ; coordinateur et futur executor : ROOT. Ce fichier ignoré est un plan gelé, pas une modification de production, une recette exécutée ou une autorisation de publication.

## 1. Décision et résultat du premier incrément

Livrer une première PR focalisée qui ferme le lock du composant préparé, la recette distincte, l’inventaire exact du contexte et des documents, et le prédicat de delta filesystem/configuration. Elle contient des fonctions pures, une recette et des tests sur données explicitement synthétiques ; aucun CLI de build/deploy/publish, workflow ou accès registre.

Résultat possible après DoD, revue indépendante, CI finale, merge identique et CI main : SOURCE_DONE_ON_MAIN pour ce contrat source seulement. L’image reste UNBUILT / NOT_ESTABLISHED ; TASK-0005A et TASK-0005 restent IN_PROGRESS, TASK-0104 reste bloquée. Préparation reproducible, fonctionnement dans l’image, vulnérabilités, publication, attestation, admission et activation sont des preuves différentes.

Le publisher, le transport/remote et l’audit ne font pas partie du plus petit incrément source cohérent. Les ajouter maintenant couplerait ce contrat à un sujet OCI, un format d’archive et des preuves qui n’existent pas encore. Aucun V2 deployer ne commence avant la fermeture de ce premier contrat.

## 2. Faits du repo : base et chemin

La base est exactement postgres:17.11-alpine3.24, linux/amd64, variant null :
- index : sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 ;
- manifest de plateforme : sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3 ;
- config de base : sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537.

Le contrat historique infra/postgres-image/filesystem-policy.json décrit dans CETTE base usr/local/bin/gosu, régulier,0755,uid/gid0,1769900 octets/SHA25652c8749d0142edd234e9d6bd5237dff2d81e71f43537e2f4f66f75dd4b243dd0,mtime1789680549. evidence.mjs exige aussi l’absence de usr/bin/gosu dans la base. Ce sont des faits retenus du contrat V1 ; une future opération image doit encore authentifier les véritables bytes/config/manifest de cette base.

La recette V1 infra/postgres-image/Dockerfile SUPPRIME /usr/local/bin/gosu, installe l’APK Alpine gosu1.19-r5 à /usr/bin/gosu et modifie sa DB. Son candidat historique0045bdab… n’est donc pas la base du nouvel incrément.

La nouvelle recette repart de l’upstream aa90e97… et remplace au MÊME chemin /usr/local/bin/gosu. Ne pas déplacer le dérivé à /usr/bin/gosu, ne pas conserver deux executables, ne pas installer l’APK et ne pas lui attribuer sa signature/package identity. /etc/apk/** et /lib/apk/db/** restent intégralement inchangés : contenu, présence, type, liens, mode, uid/gid et mtime. Cela inclut world, installed, scripts, triggers, keys et repositories.

## 3. DoR : préparation réelle et pins avant code

Base source observée : main d7bc2412104839e0be67ee97171d281b50465ccc, arbre6ed598a31353e229b4e00fed18060e05108dbe12, parent75ca260c49510236cfbaa2e79f61e344ea3dd073 ; HEAD de la PR1670ddbdf12465b40433ac4b91b0e0695ea6665e7ad a le même arbre. La branche d’implémentation proposée est codex/task-0005a-gosu-derivative-candidate-source ; ROOT recontrôle le main réel avant création/intégration, sans écraser des travaux concurrents.

Prérequis obligatoires, à vérifier et geler avant toute production edit :
1. Clôture source PR167 : .omx/gosu-public-license-delivery-review-v1.json,8855/SHA2567e52c556609bd14c6947de95d11b307261c073f57b961509b5d03e6118840175, SOURCE_DONE_ON_MAIN.
2. Actual11 run38485260984,attempt1,main d7bc : original-review-v1.json7317/SHA1132497cf1f9b913a2f3b5a2ba52d8dd373d4c8be4701a0d25e56e8d77e38250 ; comparaison originale1225/SHA9118376b641237457a177405edfbb7faa926027f3e93d8b0885661eb3131b439 ; projection2818/SHA6eaf6f2c1ba6fc23b7819a87f8f69086d03a9fabfd43638266ab79297d1b9c5a.
3. Résultat genuine .omx/gosu-public-license-actual11-archive-call-v1/validation.stdout.bin,8857/SHA10180b1d8ae7bc053771480c8bb08215985ad6663236b6e1f3ef62f2b05f19b2 ; caller index8261/SHA9e903fde0a45f4491718086084c86853154080634752361be8be406e5c69a970. Ces deux producteurs gardent leurs états REVIEW_PENDING historiques.
4. Revue indépendante désormais présente : .omx/gosu-public-license-actual11-archive-review-v1.json,3643/SHAeb862271418d63846aa44ae989ae7327899e9696b4bf0560510d1d83984a726b, PASS_CLEAR/findings[]/REPRODUCIBLE_SOURCE_PREPARATION_ONLY. ROOT doit accepter le couple de preuves exactes et ses limites ; ce plan ne refait pas cet audit.
5. Binairе dérivé réel :1936912 octets/SHA256d0a386b6fcd757540277ed91e213e7c51f2406bad2965535ce0bd2c6214339d4, composant auto-world-gosu/1.19-go1.26.9-r1. ActualTestCount0 ; functionalValidation et vulnerabilityClearance NOT_ESTABLISHED.
6. Lier le lock brut de préparation5109/SHA d9a8eb3447db727d47f486cc48a3bef3b91b629d493ec6485cfd5b6d7c9297d7, les trois helpers exacts et les deux TAR/artifacts acceptés. Obtenir, par une opération locale distincte revue sur les originaux déjà retenus, les identités exactes des documents à installer. Aucune nouvelle capture provider ni redownload. Les hashes non encore projetés ne sont ni inventés ni remplacés par des placeholders.
7. Architecte puis Critic distincts sur ce plan, gel de la baseline/des fichiers protégés et corpus/tests avant modifications. Aucun Docker/base pull, matérialisation, exécution Go/gosu/containers ou publication n’est autorisé par cette tranche de plan.

Onze actuals ont consommé leurs originaux, sans retry/redownload/rerun :38192612138,38194957502,38200213629,38204301387,38209201492,38214245572,38227184667,38432916399,38449087110,38473597270,38485260984. Les échecs, drafts et limites restent retenus.

## 4. Scope exact de la PR A

Nouveaux fichiers :
- infra/postgres-image/gosu-derivative-candidate-lock-v2.json
- infra/postgres-image/Dockerfile.gosu-derivative-v2
- scripts/postgres-image/gosu-derivative-candidate-v2.mjs
- scripts/postgres-image/gosu-derivative-filesystem-v2.mjs
- tests/postgres-gosu-derivative-candidate-v2.test.mjs
- tests/postgres-gosu-derivative-filesystem-v2.test.mjs
- roadmap/plans/TASK-0005A-gosu-derivative-candidate-source.md
- docs/validation/TASK-0005A-gosu-derivative-candidate-source.md

Modifications documentaires append-only : docs/decisions/ADR-0015-gosu-compiler-derivative.md, docs/decisions/README.md et DELIVERY.md. Donc11 chemins,8 nouveaux et3 documents existants. Toute extension requiert une nouvelle revue de scope ; ce plan n’autorise aucune autre écriture.

candidate-v2 regroupe le schéma du lock, les identités d’entrée et la génération/validation des documents et de l’inventaire du contexte. filesystem-v2 contient seulement le prédicat de delta sur inventaires authentifiés et la configuration. Pas de framework de lecteurs, de commande dynamique, de dépendance ou de nouvel opérateur CLI.

Immuables : V1 Dockerfile/lock/filesystem-policy/evidence/filesystem/diagnostic/candidate-proof/publisher/remote/read/audit ; préparation lock/helpers/165packets/workflow ; admission-inventory.executionFiles et tous execution pins ; classification/entrypoint/broker ; anciennes recettes/subjects/receipts/inventaires/Native/duties/support/currentEvidence. Aucun workflow existant n’est réactivé ni dispatché.

## 5. Lock, recette et documents V2

POSTGRES_GOSU_DERIVATIVE_CANDIDATE_SOURCE_LOCK_V2, schemaVersion2, state SOURCE_ONLY, authority NOT_AUTHORIZED, dates null. Champs fermés : composant, base exacte, préparation externe revue, binary exact, installation, evidence, sourceContract, claims et dates. La préparation et ses receipts ne deviennent ni une signature Alpine ni une admission.

Séparer les identités : binary préparé ; TARs de préparation ; ZIPs Actions ; revue/comparaison acceptées ; source lock/helpers ; recette et source commit ; futur config/manifest/diffIDs/registry subject. Ne pas confondre configID, manifestDigest, archiveSHA, DiffID décompressé et digest de couche compressée.

Recette minimale proposée :
~~~dockerfile
FROM postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3
COPY --chown=0:0 gosu /usr/local/bin/gosu
COPY --chown=0:0 auto-world-gosu/ /usr/share/licenses/auto-world-gosu/
~~~

Le futur contexte authentifié impose gosu0755,mtime0 ; fichiers evidence0644,mtime0 ; répertoires0755,uid/gid0. COPY conserve ces modes validés ; la preuve finale de delta les vérifie de nouveau. Aucun RUN, apk, ADD, URL, shell, probe --version, multi-stage, compilation, USER/ENV/ENTRYPOINT/CMD/WORKDIR/VOLUME/EXPOSE ou changement de labels. Les contextes génériques/fallbacks et fichiers non allowlistés sont refusés. Cela évite un nouveau frontend/dependency uniquement pour chmod.

Sous /usr/share/licenses/auto-world-gosu/, exactement12 fichiers réguliers :
gosu-LICENSE, moby-user-LICENSE, go-LICENSE, go-PATENTS, x-sys-LICENSE, x-sys-PATENTS, notices.json, module-closure.json, sbom.cdx.json, version.txt, build-info.txt, derivative-manifest.json.

Les11 documents existants proviennent de la paire de préparation acceptée, leurs bodies/identités exacts doivent concorder avec le lock et les deux receipts. Les six LICENSE/PATENTS ne sont pas réécrits ; notices.json reste l’absence canonique, pas une notice juridique inventée. Conserver la confidentialité des documents générés : aucun chemin hôte, token, stack, env ou contenu arbitraire ; aucune exemption licenses/*.

Le manifest canonique POSTGRES_GOSU_DERIVATIVE_IMAGE_EVIDENCE_V2 lie composant, source/compiler/module closure, binary et chemin d’installation, provenance de préparation et identités des11 documents. Il déclare PREPARATION_ONLY/NOT_AUTHORIZED/dates null et tests0/fonctionnel-vulnérabilités non établis. Il ne contient ni son propre hash, ni lockRawSHA, ni recipeSHA/futur imageDigest. Le lock peut donc pinner le résultat généré sans cycle ; le source index externe lie bytes du lock, recette et modules après commit. Aucun hash futur ou main build SHA fictif.

Borne d’entrée binary64MiB, identité réelle exacte requise ; documents256KiB par fichier/1MiB au total,12 fichiers seulement ; JSON64KiB/forme canonique exacte ; inventaires filesystem100000 membres au plus, chemins canoniques et types fermés. Les caps ne sont pas des mesures. Pas de payload binaire ajouté au Git : le contexte concret reste une preuve locale privée de phase ultérieure.

## 6. Delta fermé et ce qu’il démontre

Le prédicat V2 prend la base et le candidat issus d’une preuve de bytes, jamais des seules sorties docker inspect ni d’un booléen auto-déclaré. Tests de PR A : inventaires synthétiques, sans les décrire comme preuves d’image réelle.

Remplacement unique usr/local/bin/gosu : ancien descriptor de base exact, nouveau régulier0755/root:root/mtime0/1936912/d0a386… ; aucune suppression/renommage ou entrée usr/bin/gosu. Ajouts exclusifs des12 fichiers evidence et des répertoires strictement nécessaires sous usr/share/licenses/auto-world-gosu. Les ancêtres préexistants restent directories avec mode/propriétaire inchangés ; seules leurs mtimes, si effectivement nécessaires, peuvent suivre une liste littérale et une fenêtre de build indépendante revue. Un ancêtre absent doit être explicitement listé comme ajout0755/root:root. Mesurer leur présence dans la base avant phase image, sans supposer son arborescence.

Tous les autres chemins et attributs sont identiques, en particulier APK DB/keys/repositories. Refuser payload supplémentaire, exécutable ajouté ailleurs, executable evidence, liens/symlinks/hardlinks pour les nouvelles entrées, setuid/setgid/sticky inattendus, device/FIFO/socket, path aliases/traversal/duplicates et toute modification des données PostgreSQL/entrypoint/config. Les hardlinks/symlinks déjà présents dans la base sont conservés exactement, jamais suivis pour accepter une nouvelle entrée.

Réutiliser sans modifier validatePostgresConfigDelta de evidence.mjs pour le runtime config : expectedAdditionalLabels={}, aucune mutation Env/Cmd/Entrypoint/User/Volumes/ports/health/working directory. L’éventuelle propriété builder Image doit correspondre à une attente explicite de la base/profil de builder, pas à un champ fourni par le candidat ; aucune ignore-list générale.

Les inventaires ne prouvent pas des métadonnées qu’ils ne représentent pas. Le futur lecteur des nouvelles couches doit rejeter whiteouts/opaque dirs/PAX/xattrs/capabilities non prévus et authentifier config/layers/chain avant projection. Hériter des couches de base par digest exact ne permet pas un overlay caché. La PR A ferme ce contrat et ses attaques, pas un parse d’archive d’image encore inexistante.

## 7. Candidate proof et phases suivantes

candidate-proof.mjs est une dépendance d’exécution historique : archiveOptions et remoteOptions imposent12 couches et une base de10 ; les tags/layout/compatibility JSON/media-types sont aussi fermés. L’alléger ou lui passer un nouveau candidat par un alias V1 casserait les execution pins et la provenance. Ni12, ni10, ni ses vieux DiffIDs ne deviennent des mesures du nouvel objet.

PR B distincte, après A livrée : fermeture d’un profil POSTGRES_GOSU_DERIVATIVE_CANDIDATE_PROOF_V2 et source d’un build/lecteur diagnostic sans registry write, avec candidate-proof-v2.mjs et receipt/schema V2. Réutiliser les exports purs V1 seulement si le profil NOUVEAU observé satisfait réellement chacun de leurs prérequis ; sinon nouveau codec V2 local fondé sur les mécanismes existants et tests stricts, sans modifier V1 ni introduire un parser/framework/dependency général. Le choix exact de codec et son scope doivent être figés AVANT code B. Un collector diagnostique éventuellement nécessaire à mesurer le format a son propre plan/producer/review/permission et ne produit qu’une observation retenue non acceptée.

Avant acceptance B : manifest/config complets authentifiés ; couches héritées exactement la chaîne de la base ; count/size/media-types et couches ajoutées dérivés du vrai profil/recette, jamais d’un self-report candidat ou des counts V1 ; archive hash/EOF/layout + DiffIDs + compressés liés ; delta de §6 et preuve des documents bytes. Aucun digest/configID d’image n’est prédit maintenant. Aucun binaire téléchargé n’est exécuté par le proof reader.

PR C distincte publisher V2 : seulement après contrats A/B, concret workflow/package/credential/retention plan revu Architect puis Critic, sources finales/CI/merge/main revus et images/contenu non sensibles. Même package existant ghcr.io/clemey15/auto-world-postgres-gosu/package15408021 ; visibilité/configuration, authorized read et anonymous denial contemporains avant write. Aucun nouveau package/service/credential ni OIDC ; résultat PUBLISHED_UNADMITTED. Fork test reste SKIPPED_BY_USER/isolation NOT_VERIFIED, pas réintroduit indirectement.

PR D read/audit V2 : nouveau policy/publication receipt/sujet exact, package-read seulement, source/recipe/build SHA explicite, pulled manifest/config/layers/archive complets. Réutiliser les mécanismes stricts actuels de candidate-remote/read/audit et registry-proof/scan lorsque compatibles, via entrypoints/versionnement distincts ; ne pas retargeter les records V1 ou un vieux receipt. Audit du nouveau sujet et de tous helpers exécutés, scanner/control/database byte pins et actualités ADR0007 ; aucune waiver CVE. Les captures et échecs gardent leur vérité.

Ensuite seulement runtime PostgreSQL/uid70/command-v gosu réellement /usr/local/bin/gosu, readiness/persistence/restore, closure sources/notices, official attest/verify, seconde copie privée/restauration, génération PENDING avec dates/currentEvidence null, puis activation distincte revue. Une année de support commence à activation, archivage au moins365 jours après sa fin. Ces phases restent hors A et hors autorité de ce plan.

## 8. Tests et critères d’acceptation A

Avant code, geler un RED sémantique montrant que le contrat V1 refuse ce remplacement au même chemin sans changements APK, avec son contrôle positif V1 conservé. Ce constat ne demande pas que V1 accepte V2 ; les échecs d’import/harness ne sont pas des RED de comportement. Étendre ensuite les tests propres V2, sans stubber les predicates de sécurité.

Positifs : lock réel de préparation acceptée ; context inventory/docs canonique avec bytes hashés ; fixture complète base→same-path+12docs ; runtime config inchangé. Tout fixture d’image/inventaire synthétique est étiqueté, jamais projeté en acceptance réelle.

Rejets : lock/prototype/getter/proxy/clé inconnue ; binaire mauvais/hash-taille-mode-owner/ancien APK hash/signature revendiquée ; receipt/prep review substitué ou pending ; one-job-only/mauvais run/head/attempt ; document modifié ou receipt rehash coordonné ; six licences absentes/renommées/modifiées ; notice/SBOM/module/vcs/devel faux ; private paths/tokens dans manifest ; extra context file/absolute/traversal/link/nested alias ; APK byte OU metadata change ; usr/bin second executable ; evidence executable ou setuid ; parent lien ; opaque whiteout/xattr présenté comme inventaire complet ; changement runtime Env/entrypoint/volume/user/label ; contexte/resource cap ; fausse authority/date/currentEvidence ; cycle de hashes ou preuve OCI auto-déclarée.

Tests de recipe : FROM digest exact et uniquement les deux COPY ; aucun apk/RUN/ADD/network/probe/source execution ou changement config. Tests de protection : tous executionFiles V1 et source/helpers/workflows/admission/Native inchangés, et anciens tests V1 toujours verts. Tester les callbacks avec leurs véritables inputs, ne pas substituer une collection plus permissive pour obtenir le vert.

DoD : targeted Windows+Linux avec toolchain Node22.23.2/pnpm10.15.0 ; lint/typecheck/root+workspace tests/build/secrets/audit appropriés et résultats originaux frais, cache/platform exclusions explicites ; diff check ; docs/observabilité/rollback ; revues source/security et architecture indépendantes ; frozen final source index et raw Git identities ; PR focalisée puis CI exact final head, merge avec arbre identique et main CI, delivery indépendante. Rapporter les counts observés, pas recopier ceux de PR167. UI inchangée ; aucun nouveau UI gate spécifique. Aucun local gate ne remplace le final/main delivery.

## 9. Erreurs, opérations et rollback

Erreurs fermées : postgres_gosu_derivative_preparation_unaccepted, lock_invalid, binary_identity_invalid, evidence_invalid, context_invalid, filesystem_delta_invalid, config_delta_invalid (préfixe postgres_gosu_derivative_ pour chacune). Messages fixes sans values/paths/stack/errno brut. Les futurs opérateurs capturent phase/result/reason/duration et identités publiques sûres, stdout/stderr privés bornés, CNEW et FAILED_RETAINED ; pas de retry silencieux, cleanup global ou suppression de preuves.

Pas de migration ni effet runtime dans A. Rollback abandonne/revert uniquement les11 chemins possédés, avec historique et proofs retenus ; aucune restauration d’un binaire vulnérable/admission révoquée comme fallback. Les recettes/inventaires/V1/duties/volumes/backups demeurent intacts.

Le plan est terminé quand ROOT dispose d’une tranche A revue et de ses DoR exacts avant code. Il ne demande aucun write registre, workflow dispatch, pull, conteneur, Native, Go/gosu, archive member read/extraction ou mutation source. Référentiels : ROADMAP.md, docs/DEFINITION_OF_DONE.md, ADR0015 §§Exact build/Manual workflow/Later dependent phases et ADR0007 §§Integrity/privacy/capabilities,Admission,Retention,Delivery.

