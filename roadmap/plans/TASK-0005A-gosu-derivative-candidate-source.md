# TASK-0005A - Gosu derivative source candidate

Status: PREPARED_SOURCE_ONLY; implementation, targeted Windows/Linux and local gates complete; final source delivery pending. Image UNBUILT; no publication, runtime or admission authority.

Accepted prerequisites: preparation record PR168 is SOURCE_DONE_ON_MAIN at a6cd921ce9a8fe2858fd0bd0af9f6dbaf0401344/tree ea799002b831f7711f01872c193119b229578712, final CI38490647313/main CI38491904770 SUCCESS, independent delivery7294/SHA25693c232ca0684e1dac89aa9a56346d11ff910f0a474250015502ae1c7e305e316. The independent document projection7784/SHA25652161f387ff2d5243805a2ca6c6c91a43ec1accfea6b74a46afb1566d57a4733 accepts11 byte-equal document identities,30951 bytes, on the retained actual11 pair. Architecture plan19965/SHA256ff17bff30ac5fde2e3519d4b9dfc7c60d2cfacf5f21df78597863012e140d66c and distinct critic3784/SHA2562b86c0c61fe61a446f4423cf935dc5fba442d9aa6dd0e83c89c724943cb1dc90 are frozen. The943-file baseline203419/SHA256b9789904caffe7b2d6de0a0d90f42f3280891c33f007577847653f92fc672c3e precedes source edits. Those private local evidence identities do not claim public downloads or clean-clone availability.

The approved plan below preserves its earlier source observations. This increment starts from accepted main a6cd921c and keeps the seven PR168 record documents byte-identical except the three explicitly append-only ADR/index/DELIVERY paths. A source-only interface supplement will close the two pure modules before parallel implementation. Actual context/image proof remains a later phase.

# PostgreSQL â€” contrat source du candidat gosu dÃ©rivÃ©

Ã‰tat : ARCHITECT_PLAN_REVIEW_PENDING / SOURCE_ONLY. Auteur : architecture indÃ©pendante ; coordinateur et futur executor : ROOT. Ce fichier ignorÃ© est un plan gelÃ©, pas une modification de production, une recette exÃ©cutÃ©e ou une autorisation de publication.

## 1. DÃ©cision et rÃ©sultat du premier incrÃ©ment

Livrer une premiÃ¨re PR focalisÃ©e qui ferme le lock du composant prÃ©parÃ©, la recette distincte, lâ€™inventaire exact du contexte et des documents, et le prÃ©dicat de delta filesystem/configuration. Elle contient des fonctions pures, une recette et des tests sur donnÃ©es explicitement synthÃ©tiques ; aucun CLI de build/deploy/publish, workflow ou accÃ¨s registre.

RÃ©sultat possible aprÃ¨s DoD, revue indÃ©pendante, CI finale, merge identique et CI main : SOURCE_DONE_ON_MAIN pour ce contrat source seulement. Lâ€™image reste UNBUILT / NOT_ESTABLISHED ; TASK-0005A et TASK-0005 restent IN_PROGRESS, TASK-0104 reste bloquÃ©e. PrÃ©paration reproducible, fonctionnement dans lâ€™image, vulnÃ©rabilitÃ©s, publication, attestation, admission et activation sont des preuves diffÃ©rentes.

Le publisher, le transport/remote et lâ€™audit ne font pas partie du plus petit incrÃ©ment source cohÃ©rent. Les ajouter maintenant couplerait ce contrat Ã  un sujet OCI, un format dâ€™archive et des preuves qui nâ€™existent pas encore. Aucun V2 deployer ne commence avant la fermeture de ce premier contrat.

## 2. Faits du repo : base et chemin

La base est exactement postgres:17.11-alpine3.24, linux/amd64, variant null :
- index : sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 ;
- manifest de plateforme : sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3 ;
- config de base : sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537.

Le contrat historique infra/postgres-image/filesystem-policy.json dÃ©crit dans CETTE base usr/local/bin/gosu, rÃ©gulier,0755,uid/gid0,1769900 octets/SHA25652c8749d0142edd234e9d6bd5237dff2d81e71f43537e2f4f66f75dd4b243dd0,mtime1789680549. evidence.mjs exige aussi lâ€™absence de usr/bin/gosu dans la base. Ce sont des faits retenus du contrat V1 ; une future opÃ©ration image doit encore authentifier les vÃ©ritables bytes/config/manifest de cette base.

La recette V1 infra/postgres-image/Dockerfile SUPPRIME /usr/local/bin/gosu, installe lâ€™APK Alpine gosu1.19-r5 Ã  /usr/bin/gosu et modifie sa DB. Son candidat historique0045bdabâ€¦ nâ€™est donc pas la base du nouvel incrÃ©ment.

La nouvelle recette repart de lâ€™upstream aa90e97â€¦ et remplace au MÃŠME chemin /usr/local/bin/gosu. Ne pas dÃ©placer le dÃ©rivÃ© Ã  /usr/bin/gosu, ne pas conserver deux executables, ne pas installer lâ€™APK et ne pas lui attribuer sa signature/package identity. /etc/apk/** et /lib/apk/db/** restent intÃ©gralement inchangÃ©s : contenu, prÃ©sence, type, liens, mode, uid/gid et mtime. Cela inclut world, installed, scripts, triggers, keys et repositories.

## 3. DoR : prÃ©paration rÃ©elle et pins avant code

Base source observÃ©e : main d7bc2412104839e0be67ee97171d281b50465ccc, arbre6ed598a31353e229b4e00fed18060e05108dbe12, parent75ca260c49510236cfbaa2e79f61e344ea3dd073 ; HEAD de la PR1670ddbdf12465b40433ac4b91b0e0695ea6665e7ad a le mÃªme arbre. La branche dâ€™implÃ©mentation proposÃ©e est codex/task-0005a-gosu-derivative-candidate-source ; ROOT recontrÃ´le le main rÃ©el avant crÃ©ation/intÃ©gration, sans Ã©craser des travaux concurrents.

PrÃ©requis obligatoires, Ã  vÃ©rifier et geler avant toute production edit :
1. ClÃ´ture source PR167 : .omx/gosu-public-license-delivery-review-v1.json,8855/SHA2567e52c556609bd14c6947de95d11b307261c073f57b961509b5d03e6118840175, SOURCE_DONE_ON_MAIN.
2. Actual11 run38485260984,attempt1,main d7bc : original-review-v1.json7317/SHA1132497cf1f9b913a2f3b5a2ba52d8dd373d4c8be4701a0d25e56e8d77e38250 ; comparaison originale1225/SHA9118376b641237457a177405edfbb7faa926027f3e93d8b0885661eb3131b439 ; projection2818/SHA6eaf6f2c1ba6fc23b7819a87f8f69086d03a9fabfd43638266ab79297d1b9c5a.
3. RÃ©sultat genuine .omx/gosu-public-license-actual11-archive-call-v1/validation.stdout.bin,8857/SHA10180b1d8ae7bc053771480c8bb08215985ad6663236b6e1f3ef62f2b05f19b2 ; caller index8261/SHA9e903fde0a45f4491718086084c86853154080634752361be8be406e5c69a970. Ces deux producteurs gardent leurs Ã©tats REVIEW_PENDING historiques.
4. Revue indÃ©pendante dÃ©sormais prÃ©sente : .omx/gosu-public-license-actual11-archive-review-v1.json,3643/SHAeb862271418d63846aa44ae989ae7327899e9696b4bf0560510d1d83984a726b, PASS_CLEAR/findings[]/REPRODUCIBLE_SOURCE_PREPARATION_ONLY. ROOT doit accepter le couple de preuves exactes et ses limites ; ce plan ne refait pas cet audit.
5. BinairÐµ dÃ©rivÃ© rÃ©el :1936912 octets/SHA256d0a386b6fcd757540277ed91e213e7c51f2406bad2965535ce0bd2c6214339d4, composant auto-world-gosu/1.19-go1.26.9-r1. ActualTestCount0 ; functionalValidation et vulnerabilityClearance NOT_ESTABLISHED.
6. Lier le lock brut de prÃ©paration5109/SHA d9a8eb3447db727d47f486cc48a3bef3b91b629d493ec6485cfd5b6d7c9297d7, les trois helpers exacts et les deux TAR/artifacts acceptÃ©s. Obtenir, par une opÃ©ration locale distincte revue sur les originaux dÃ©jÃ  retenus, les identitÃ©s exactes des documents Ã  installer. Aucune nouvelle capture provider ni redownload. Les hashes non encore projetÃ©s ne sont ni inventÃ©s ni remplacÃ©s par des placeholders.
7. Architecte puis Critic distincts sur ce plan, gel de la baseline/des fichiers protÃ©gÃ©s et corpus/tests avant modifications. Aucun Docker/base pull, matÃ©rialisation, exÃ©cution Go/gosu/containers ou publication nâ€™est autorisÃ© par cette tranche de plan.

Onze actuals ont consommÃ© leurs originaux, sans retry/redownload/rerun :38192612138,38194957502,38200213629,38204301387,38209201492,38214245572,38227184667,38432916399,38449087110,38473597270,38485260984. Les Ã©checs, drafts et limites restent retenus.

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

Modifications documentaires append-only : docs/decisions/ADR-0015-gosu-compiler-derivative.md, docs/decisions/README.md et DELIVERY.md. Donc11 chemins,8 nouveaux et3 documents existants. Toute extension requiert une nouvelle revue de scope ; ce plan nâ€™autorise aucune autre Ã©criture.

candidate-v2 regroupe le schÃ©ma du lock, les identitÃ©s dâ€™entrÃ©e et la gÃ©nÃ©ration/validation des documents et de lâ€™inventaire du contexte. filesystem-v2 contient seulement le prÃ©dicat de delta sur inventaires authentifiÃ©s et la configuration. Pas de framework de lecteurs, de commande dynamique, de dÃ©pendance ou de nouvel opÃ©rateur CLI.

Immuables : V1 Dockerfile/lock/filesystem-policy/evidence/filesystem/diagnostic/candidate-proof/publisher/remote/read/audit ; prÃ©paration lock/helpers/165packets/workflow ; admission-inventory.executionFiles et tous execution pins ; classification/entrypoint/broker ; anciennes recettes/subjects/receipts/inventaires/Native/duties/support/currentEvidence. Aucun workflow existant nâ€™est rÃ©activÃ© ni dispatchÃ©.

## 5. Lock, recette et documents V2

POSTGRES_GOSU_DERIVATIVE_CANDIDATE_SOURCE_LOCK_V2, schemaVersion2, state SOURCE_ONLY, authority NOT_AUTHORIZED, dates null. Champs fermÃ©s : composant, base exacte, prÃ©paration externe revue, binary exact, installation, evidence, sourceContract, claims et dates. La prÃ©paration et ses receipts ne deviennent ni une signature Alpine ni une admission.

SÃ©parer les identitÃ©s : binary prÃ©parÃ© ; TARs de prÃ©paration ; ZIPs Actions ; revue/comparaison acceptÃ©es ; source lock/helpers ; recette et source commit ; futur config/manifest/diffIDs/registry subject. Ne pas confondre configID, manifestDigest, archiveSHA, DiffID dÃ©compressÃ© et digest de couche compressÃ©e.

Recette minimale proposÃ©e :
~~~dockerfile
FROM postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3
COPY --chown=0:0 gosu /usr/local/bin/gosu
COPY --chown=0:0 auto-world-gosu/ /usr/share/licenses/auto-world-gosu/
~~~

Le futur contexte authentifiÃ© impose gosu0755,mtime0 ; fichiers evidence0644,mtime0 ; rÃ©pertoires0755,uid/gid0. COPY conserve ces modes validÃ©s ; la preuve finale de delta les vÃ©rifie de nouveau. Aucun RUN, apk, ADD, URL, shell, probe --version, multi-stage, compilation, USER/ENV/ENTRYPOINT/CMD/WORKDIR/VOLUME/EXPOSE ou changement de labels. Les contextes gÃ©nÃ©riques/fallbacks et fichiers non allowlistÃ©s sont refusÃ©s. Cela Ã©vite un nouveau frontend/dependency uniquement pour chmod.

Sous /usr/share/licenses/auto-world-gosu/, exactement12 fichiers rÃ©guliers :
gosu-LICENSE, moby-user-LICENSE, go-LICENSE, go-PATENTS, x-sys-LICENSE, x-sys-PATENTS, notices.json, module-closure.json, sbom.cdx.json, version.txt, build-info.txt, derivative-manifest.json.

Les11 documents existants proviennent de la paire de prÃ©paration acceptÃ©e, leurs bodies/identitÃ©s exacts doivent concorder avec le lock et les deux receipts. Les six LICENSE/PATENTS ne sont pas rÃ©Ã©crits ; notices.json reste lâ€™absence canonique, pas une notice juridique inventÃ©e. Conserver la confidentialitÃ© des documents gÃ©nÃ©rÃ©s : aucun chemin hÃ´te, token, stack, env ou contenu arbitraire ; aucune exemption licenses/*.

Le manifest canonique POSTGRES_GOSU_DERIVATIVE_IMAGE_EVIDENCE_V2 lie composant, source/compiler/module closure, binary et chemin dâ€™installation, provenance de prÃ©paration et identitÃ©s des11 documents. Il dÃ©clare PREPARATION_ONLY/NOT_AUTHORIZED/dates null et tests0/fonctionnel-vulnÃ©rabilitÃ©s non Ã©tablis. Il ne contient ni son propre hash, ni lockRawSHA, ni recipeSHA/futur imageDigest. Le lock peut donc pinner le rÃ©sultat gÃ©nÃ©rÃ© sans cycle ; le source index externe lie bytes du lock, recette et modules aprÃ¨s commit. Aucun hash futur ou main build SHA fictif.

Borne dâ€™entrÃ©e binary64MiB, identitÃ© rÃ©elle exacte requise ; documents256KiB par fichier/1MiB au total,12 fichiers seulement ; JSON64KiB/forme canonique exacte ; inventaires filesystem100000 membres au plus, chemins canoniques et types fermÃ©s. Les caps ne sont pas des mesures. Pas de payload binaire ajoutÃ© au Git : le contexte concret reste une preuve locale privÃ©e de phase ultÃ©rieure.

## 6. Delta fermÃ© et ce quâ€™il dÃ©montre

Le prÃ©dicat V2 prend la base et le candidat issus dâ€™une preuve de bytes, jamais des seules sorties docker inspect ni dâ€™un boolÃ©en auto-dÃ©clarÃ©. Tests de PR A : inventaires synthÃ©tiques, sans les dÃ©crire comme preuves dâ€™image rÃ©elle.

Remplacement unique usr/local/bin/gosu : ancien descriptor de base exact, nouveau rÃ©gulier0755/root:root/mtime0/1936912/d0a386â€¦ ; aucune suppression/renommage ou entrÃ©e usr/bin/gosu. Ajouts exclusifs des12 fichiers evidence et des rÃ©pertoires strictement nÃ©cessaires sous usr/share/licenses/auto-world-gosu. Les ancÃªtres prÃ©existants restent directories avec mode/propriÃ©taire inchangÃ©s ; seules leurs mtimes, si effectivement nÃ©cessaires, peuvent suivre une liste littÃ©rale et une fenÃªtre de build indÃ©pendante revue. Un ancÃªtre absent doit Ãªtre explicitement listÃ© comme ajout0755/root:root. Mesurer leur prÃ©sence dans la base avant phase image, sans supposer son arborescence.

Tous les autres chemins et attributs sont identiques, en particulier APK DB/keys/repositories. Refuser payload supplÃ©mentaire, exÃ©cutable ajoutÃ© ailleurs, executable evidence, liens/symlinks/hardlinks pour les nouvelles entrÃ©es, setuid/setgid/sticky inattendus, device/FIFO/socket, path aliases/traversal/duplicates et toute modification des donnÃ©es PostgreSQL/entrypoint/config. Les hardlinks/symlinks dÃ©jÃ  prÃ©sents dans la base sont conservÃ©s exactement, jamais suivis pour accepter une nouvelle entrÃ©e.

RÃ©utiliser sans modifier validatePostgresConfigDelta de evidence.mjs pour le runtime config : expectedAdditionalLabels={}, aucune mutation Env/Cmd/Entrypoint/User/Volumes/ports/health/working directory. Lâ€™Ã©ventuelle propriÃ©tÃ© builder Image doit correspondre Ã  une attente explicite de la base/profil de builder, pas Ã  un champ fourni par le candidat ; aucune ignore-list gÃ©nÃ©rale.

Les inventaires ne prouvent pas des mÃ©tadonnÃ©es quâ€™ils ne reprÃ©sentent pas. Le futur lecteur des nouvelles couches doit rejeter whiteouts/opaque dirs/PAX/xattrs/capabilities non prÃ©vus et authentifier config/layers/chain avant projection. HÃ©riter des couches de base par digest exact ne permet pas un overlay cachÃ©. La PR A ferme ce contrat et ses attaques, pas un parse dâ€™archive dâ€™image encore inexistante.

## 7. Candidate proof et phases suivantes

candidate-proof.mjs est une dÃ©pendance dâ€™exÃ©cution historique : archiveOptions et remoteOptions imposent12 couches et une base de10 ; les tags/layout/compatibility JSON/media-types sont aussi fermÃ©s. Lâ€™allÃ©ger ou lui passer un nouveau candidat par un alias V1 casserait les execution pins et la provenance. Ni12, ni10, ni ses vieux DiffIDs ne deviennent des mesures du nouvel objet.

PR B distincte, aprÃ¨s A livrÃ©e : fermeture dâ€™un profil POSTGRES_GOSU_DERIVATIVE_CANDIDATE_PROOF_V2 et source dâ€™un build/lecteur diagnostic sans registry write, avec candidate-proof-v2.mjs et receipt/schema V2. RÃ©utiliser les exports purs V1 seulement si le profil NOUVEAU observÃ© satisfait rÃ©ellement chacun de leurs prÃ©requis ; sinon nouveau codec V2 local fondÃ© sur les mÃ©canismes existants et tests stricts, sans modifier V1 ni introduire un parser/framework/dependency gÃ©nÃ©ral. Le choix exact de codec et son scope doivent Ãªtre figÃ©s AVANT code B. Un collector diagnostique Ã©ventuellement nÃ©cessaire Ã  mesurer le format a son propre plan/producer/review/permission et ne produit quâ€™une observation retenue non acceptÃ©e.

Avant acceptance B : manifest/config complets authentifiÃ©s ; couches hÃ©ritÃ©es exactement la chaÃ®ne de la base ; count/size/media-types et couches ajoutÃ©es dÃ©rivÃ©s du vrai profil/recette, jamais dâ€™un self-report candidat ou des counts V1 ; archive hash/EOF/layout + DiffIDs + compressÃ©s liÃ©s ; delta de Â§6 et preuve des documents bytes. Aucun digest/configID dâ€™image nâ€™est prÃ©dit maintenant. Aucun binaire tÃ©lÃ©chargÃ© nâ€™est exÃ©cutÃ© par le proof reader.

PR C distincte publisher V2 : seulement aprÃ¨s contrats A/B, concret workflow/package/credential/retention plan revu Architect puis Critic, sources finales/CI/merge/main revus et images/contenu non sensibles. MÃªme package existant ghcr.io/clemey15/auto-world-postgres-gosu/package15408021 ; visibilitÃ©/configuration, authorized read et anonymous denial contemporains avant write. Aucun nouveau package/service/credential ni OIDC ; rÃ©sultat PUBLISHED_UNADMITTED. Fork test reste SKIPPED_BY_USER/isolation NOT_VERIFIED, pas rÃ©introduit indirectement.

PR D read/audit V2 : nouveau policy/publication receipt/sujet exact, package-read seulement, source/recipe/build SHA explicite, pulled manifest/config/layers/archive complets. RÃ©utiliser les mÃ©canismes stricts actuels de candidate-remote/read/audit et registry-proof/scan lorsque compatibles, via entrypoints/versionnement distincts ; ne pas retargeter les records V1 ou un vieux receipt. Audit du nouveau sujet et de tous helpers exÃ©cutÃ©s, scanner/control/database byte pins et actualitÃ©s ADR0007 ; aucune waiver CVE. Les captures et Ã©checs gardent leur vÃ©ritÃ©.

Ensuite seulement runtime PostgreSQL/uid70/command-v gosu rÃ©ellement /usr/local/bin/gosu, readiness/persistence/restore, closure sources/notices, official attest/verify, seconde copie privÃ©e/restauration, gÃ©nÃ©ration PENDING avec dates/currentEvidence null, puis activation distincte revue. Une annÃ©e de support commence Ã  activation, archivage au moins365 jours aprÃ¨s sa fin. Ces phases restent hors A et hors autoritÃ© de ce plan.

## 8. Tests et critÃ¨res dâ€™acceptation A

Avant code, geler un RED sÃ©mantique montrant que le contrat V1 refuse ce remplacement au mÃªme chemin sans changements APK, avec son contrÃ´le positif V1 conservÃ©. Ce constat ne demande pas que V1 accepte V2 ; les Ã©checs dâ€™import/harness ne sont pas des RED de comportement. Ã‰tendre ensuite les tests propres V2, sans stubber les predicates de sÃ©curitÃ©.

Positifs : lock rÃ©el de prÃ©paration acceptÃ©e ; context inventory/docs canonique avec bytes hashÃ©s ; fixture complÃ¨te baseâ†’same-path+12docs ; runtime config inchangÃ©. Tout fixture dâ€™image/inventaire synthÃ©tique est Ã©tiquetÃ©, jamais projetÃ© en acceptance rÃ©elle.

Rejets : lock/prototype/getter/proxy/clÃ© inconnue ; binaire mauvais/hash-taille-mode-owner/ancien APK hash/signature revendiquÃ©e ; receipt/prep review substituÃ© ou pending ; one-job-only/mauvais run/head/attempt ; document modifiÃ© ou receipt rehash coordonnÃ© ; six licences absentes/renommÃ©es/modifiÃ©es ; notice/SBOM/module/vcs/devel faux ; private paths/tokens dans manifest ; extra context file/absolute/traversal/link/nested alias ; APK byte OU metadata change ; usr/bin second executable ; evidence executable ou setuid ; parent lien ; opaque whiteout/xattr prÃ©sentÃ© comme inventaire complet ; changement runtime Env/entrypoint/volume/user/label ; contexte/resource cap ; fausse authority/date/currentEvidence ; cycle de hashes ou preuve OCI auto-dÃ©clarÃ©e.

Tests de recipe : FROM digest exact et uniquement les deux COPY ; aucun apk/RUN/ADD/network/probe/source execution ou changement config. Tests de protection : tous executionFiles V1 et source/helpers/workflows/admission/Native inchangÃ©s, et anciens tests V1 toujours verts. Tester les callbacks avec leurs vÃ©ritables inputs, ne pas substituer une collection plus permissive pour obtenir le vert.

DoD : targeted Windows+Linux avec toolchain Node22.23.2/pnpm10.15.0 ; lint/typecheck/root+workspace tests/build/secrets/audit appropriÃ©s et rÃ©sultats originaux frais, cache/platform exclusions explicites ; diff check ; docs/observabilitÃ©/rollback ; revues source/security et architecture indÃ©pendantes ; frozen final source index et raw Git identities ; PR focalisÃ©e puis CI exact final head, merge avec arbre identique et main CI, delivery indÃ©pendante. Rapporter les counts observÃ©s, pas recopier ceux de PR167. UI inchangÃ©e ; aucun nouveau UI gate spÃ©cifique. Aucun local gate ne remplace le final/main delivery.

## 9. Erreurs, opÃ©rations et rollback

Erreurs fermÃ©es : postgres_gosu_derivative_preparation_unaccepted, lock_invalid, binary_identity_invalid, evidence_invalid, context_invalid, filesystem_delta_invalid, config_delta_invalid (prÃ©fixe postgres_gosu_derivative_ pour chacune). Messages fixes sans values/paths/stack/errno brut. Les futurs opÃ©rateurs capturent phase/result/reason/duration et identitÃ©s publiques sÃ»res, stdout/stderr privÃ©s bornÃ©s, CNEW et FAILED_RETAINED ; pas de retry silencieux, cleanup global ou suppression de preuves.

Pas de migration ni effet runtime dans A. Rollback abandonne/revert uniquement les11 chemins possÃ©dÃ©s, avec historique et proofs retenus ; aucune restauration dâ€™un binaire vulnÃ©rable/admission rÃ©voquÃ©e comme fallback. Les recettes/inventaires/V1/duties/volumes/backups demeurent intacts.

Le plan est terminÃ© quand ROOT dispose dâ€™une tranche A revue et de ses DoR exacts avant code. Il ne demande aucun write registre, workflow dispatch, pull, conteneur, Native, Go/gosu, archive member read/extraction ou mutation source. RÃ©fÃ©rentiels : ROADMAP.md, docs/DEFINITION_OF_DONE.md, ADR0015 Â§Â§Exact build/Manual workflow/Later dependent phases et ADR0007 Â§Â§Integrity/privacy/capabilities,Admission,Retention,Delivery.



## Accepted interface closure before implementation

Interface V1 was rejected before code for three schema/resource ambiguities. Frozen V2 10169/a49c4dd315ea732b5b732492b480f0f51394ef67c99d242b685b3f23a00f74f5 and distinct Critic 3035/dbd1026d7ff8c742c9eca081f810fd5978265e66d7c783eb3e7297985f6f1b4c close them: CLEAR_FOR_SOURCE_IMPLEMENTATION_WITHIN_FIXED_PR_A_SCOPE/findings[]. Historical V1 and rejection remain retained. Semantic V1 control passes while the same-path/unchanged-APK requirement is EXPECTED_RED_HISTORICAL_V1_SCOPE (783/cea36ed40b3af29026961c14695307694f33e44ceb22abc670d0b8c24569cb24). This is intentional V1 incompatibility, not a historical defect. The943-file baseline was byte-identical before authoring. Exact V2 interface follows.

# SupplÃ©ment dâ€™interface V2 â€” schÃ©mas fermÃ©s

V1/plan gelÃ©s,scope11 inchangÃ©. DoR PR168 maina6cd/treeea799/baseline943,actual11 et11docs/30951 acceptÃ©s. Pas dâ€™opÃ©ration.

## 1. Types communs, copie et ressources

I={bytes,sha256} : bytes entier sÃ»r0..Number.MAX_SAFE_INTEGER,sha256 lowercase64hex. ClÃ©s exactes ; plain own-data records,arrays denses sans props extra. Refuser Proxy avant rÃ©flexion/accessor/custom prototype/unknown API key. Aucun getter/iterator/toJSON/species caller ; sorties deepfrozen sans Buffer.

Bytes acceptÃ©s : seulement Buffer/Uint8Array natifs non-proxy,prototypes exacts,backing ArrayBuffer non partagÃ©/non redimensionnable/non dÃ©tachÃ©. Lire longueur/offset/backing par getters intrinsÃ¨ques de TypedArray,puis copie vers allocation propre par opÃ©rations intrinsÃ¨ques sans appel dâ€™iterator/species/getter fourni. Refuser SharedArrayBuffer avant copie ; pas dâ€™await entre validation/copie/hash. Hash/parse de copie seulement.

matchExactBytesV2(body,I) : cap67108864 avant allocation/hash ; calcul rÃ©el taille/SHA,Ã©galitÃ© exacte ; retourne I gelÃ©,sans autoritÃ©. Lock raw/JSON canoniqueâ‰¤65536 bytes ; documentsâ‰¤262144 chacun,ensemble12â‰¤1048576 ; tout JSON/manifestâ‰¤65536 ; recetteâ‰¤4096. Contexte exactement15 entries,corps totalâ‰¤67108864+1048576+4096.

Config JSON plain : profondeurâ‰¤16 (racine0),nÅ“udsâ‰¤4096 par config,chaque arrayâ‰¤1024,objetâ‰¤256 clÃ©s,clÃ© UTF8â‰¤256 bytes,string UTF8â‰¤8192,total serialization UTF8â‰¤65536 par config ; null,bool,string,nombre fini seulement,pas undefined/BigInt/fonction/cycle/alias partagÃ©. Compter avant allocation/serialization ; copie plain JSON avant V1. Comparer TOUTES clÃ©s config ; aucune nâ€™est ignorÃ©e/override.

Inventaires :1..100000 chacun,8/9 champs constants,paths ASCIIâ‰¤512/depthâ‰¤32,linknameâ‰¤1024,total paths+linksâ‰¤153600000. Cap config sÃ©parÃ©. NumÃ©riques entiers sÃ»rs non nÃ©gatifs ; modeâ‰¤07777,uid/gidâ‰¤2147483647,mtimeâ‰¤floor(Number.MAX_SAFE_INTEGER/1000),sizeâ‰¤Number.MAX_SAFE_INTEGER. SHA lowercase64hex ; inventaire hors parcours JSON/config.

## 2. Quatre exports candidate-v2

openCandidateLockV2(rawBytes) -> handle opaque gelÃ©.
candidateContractV2(handle) -> Contract ci-dessous.
matchExactBytesV2(body,I) -> I.
validateCandidateContextV2(handle,{entries}) -> ContextResult.

JSON dâ€™abord,puis BYTE_ANCHOR={bytes,sha256} littÃ©ral module,sans anchor caller. Copie/hash avant UTF8 fatal/BOM absent/JSON canonique/pins exacts. WeakMap privÃ© dÃ©tachÃ© gelÃ© ; faux/clone/autre instance rejetÃ© sans rÃ©flexion. Aucun moduleSHA nouveau dans lock. Aucun hash futur/placeholder.

Contract, clÃ©s dans cet ordre :
~~~text
{schemaVersion:2,authority:"NOT_AUTHORIZED",image:"UNBUILT",base,baseExecutable,replacement,evidenceFiles,parentPaths,manifest,recipe,contextEntries,builderProfile:"STRICT_INHERITED_CONFIG_V2"}
~~~
base={indexDigest,platformDigest,configId,platform:{os:"linux",architecture:"amd64",variant:null}} reprend les trois pins upstream exacts du plan.
FileD={path,type:"file",mode,uid,gid,mtime,size,sha256}.
baseExecutable FileD exact : usr/local/bin/gosu,0755,0,0,1789680549,1769900/52c8749d0142edd234e9d6bd5237dff2d81e71f43537e2f4f66f75dd4b243dd0.
replacement FileD exact : mÃªme path,0755,0,0,mtime0,1936912/d0a386b6fcd757540277ed91e213e7c51f2406bad2965535ce0bd2c6214339d4.

evidenceFiles :12 FileD ordonnÃ©s EXPLICITEMENT :
gosu-LICENSE,moby-user-LICENSE,go-LICENSE,go-PATENTS,x-sys-LICENSE,x-sys-PATENTS,notices.json,module-closure.json,sbom.cdx.json,version.txt,build-info.txt,derivative-manifest.json.
path prefix usr/share/licenses/auto-world-gosu/,0644/rootroot/mtime0. Onze size/SHA exactement projection revue ; dernier calculÃ© depuis manifest gÃ©nÃ©rÃ©. Matcher paths uniques,puis produire cet ordre.

manifest={text,identity:I},recipe={text,identity:I},aucun Buffer. Canon(obj) = JSON.stringify(obj,null,2)+"\n",clÃ©s construites dans ordre ci-dessous,UTF8 sans BOM/CR ni espace final ajoutÃ©. Ne pas serialiser directement les objets caller. Manifest identity calculÃ©e aprÃ¨s texte ; jamais prÃ©sente dans manifest lui-mÃªme.

Manifest fermÃ©, clÃ©s dans cet ordre :
~~~text
{kind:"POSTGRES_GOSU_DERIVATIVE_IMAGE_EVIDENCE_V2",schemaVersion:2,component:"auto-world-gosu/1.19-go1.26.9-r1",state:"PREPARATION_ONLY",authority:"NOT_AUTHORIZED",base,source,compiler,modules,binary,preparation,documents,claims,dates}
~~~
source={module,version,commit,archive:I,goMod:I,goSum:I},compiler={version,identity,archive:I}.
modules exactement deux dans ordre moby-user,x-sys : {id,path,version,zip:{bytes,sha256,h1},mod:{bytes,sha256,h1}}.
Depuis lock prÃ©paratoire5109/d9a8eb3447db727d47f486cc48a3bef3b91b629d493ec6485cfd5b6d7c9297d7 ; archive=bytes/SHA de source/compiler ; lock conserve projections et pins exacts du plan.
binary=replacement FileD.
preparation={runId:38485260984,headSha:"d7bc2412104839e0be67ee97171d281b50465ccc",attempt:1,event:"workflow_dispatch",workflowId:381685649,repositoryId:1357514939,artifacts,acceptance:I,comparison:I,documentProjection:I}.
artifacts exactement repeat1 puis2 : {repeat,jobId,artifactId,zip:I,tar:I},pins rÃ©els acceptÃ©s inchangÃ©s.
acceptance=archive-review-v1 I(3643/eb862â€¦),comparison=original I(1225/911837â€¦),documentProjection=candidate I(16995/b4230â€¦) acceptÃ©e par revue7784/52161fâ€¦.
documents :11 {name,bytes,sha256} dans ordre evidenceFiles sans manifest ; aucun body/chemin hÃ´te.
claims={actualTestCount:0,functionalValidation:"NOT_ESTABLISHED",vulnerabilityClearance:"NOT_ESTABLISHED",image:"UNBUILT"}.
dates={supportStartsAt:null,supportEndsAt:null,archiveRetainUntil:null}.
Aucun ownhash/lockRawSHA/recipeSHA/futur imageDigest ; index externe lie lock/modules/recipe,sans cycle.

Recipe text EXACT :
FROM postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3
COPY --chown=0:0 gosu /usr/local/bin/gosu
COPY --chown=0:0 auto-world-gosu/ /usr/share/licenses/auto-world-gosu/
Trois lignes LF,LF FINAL,BOM/CR absent.

contextEntries : Dockerfile FileD relatif0644,gosu FileD relatif0755,puis directory auto-world-gosu et12 FileD auto-world-gosu/<nom> dans ordre ci-dessus ; uid/gid0,mtime0,directory size0 et pas SHA. Donc14files/1directory. EntrÃ©es validateCandidateContext : File={path,type,mode,uid,gid,mtime,body},Directory={path,type,mode,uid,gid,mtime},sans size/hash caller. Hash rÃ©el contre descriptors,recipe/manifest exacts.
ContextResult={scope:"CONTEXT_BYTES_MATCH_SOURCE_CONTRACT_ONLY",authority:"NOT_AUTHORIZED",image:"UNBUILT",files:14,directories:1,binary:I,evidenceBytes,manifest:I,recipe:I}. Pas de faux positif full context/stub genuine. Tests rÃ©els lock/manifest/descriptors/recipe ; matcher positif petit explicitement synthÃ©tique.

## 3. Trois exports filesystem-v2

compareFilesystemInventoriesV2({baseEntries,candidateEntries,expectation}) -> Delta.
validateCandidateFilesystemV2(handle,{baseEntries,candidateEntries,baseConfig,candidateConfig,buildWindow}) -> Delta normatif.
validateCandidateConfigurationV2(handle,{baseConfig,candidateConfig}) -> ConfigResult.

Entry file=FileD ; directory={path,type:"directory",mode,uid,gid,mtime,size:0} ; link={path,type:"symlink"|"hardlink",mode,uid,gid,mtime,size,linkname}. Hardlink size0,cible canonique file existante,mÃªmes mode/owner/mtime ; liens conservÃ©s sans suivre. Rejeter paths absolus,traversal,doubles slash/backslash/trailing slash,duplicate,types/device/FIFO/socket. Paths uniques,ordre caller sans autoritÃ©.

expectation fermÃ©={baseExecutable:FileD,replacement:FileD,evidenceFiles:FileD[12],parentPaths:Parent[6],mtimeWindow:{startSeconds,endSeconds}}. Garder paths/counts/modes/rootroot/mtime0 normatifs,usr/bin/gosu absent des deux inventaires ; seules tailles/hash et oldmtime peuvent varier pour fixtures explicitement synthÃ©tiques. Pas dâ€™allowlist arbitraire/profil override.

Parent={path,creation:{mode:0755,uid:0,gid:0},mtimePolicy:"BUILD_WINDOW"|"ZERO"} ; ordre exact :
usr,usr/local,usr/local/bin,usr/share,usr/share/licenses (BUILD_WINDOW),usr/share/licenses/auto-world-gosu (ZERO).
Parents EXISTANTS : directory,size0,tous attributs sauf mtime strictement inchangÃ©s ; mode755/rootroot concerne crÃ©ations seulement. ZERO existant reste0 dans base ET candidat,sinon rejet. Parents absents : ajouts explicites creation,size0,mtime dans fenÃªtre ou0 selon policy. Remplacement et docs toujoursmtime0. BUILD_WINDOW peut autoriser une variation seulement si un enfant direct est ajoutÃ©/remplacÃ© par le delta permis ; pas de changement de grand-parent gratuit.

Delta exact :1 remplacement same-path,12 evidence files ajoutÃ©s (prÃ©existence rejetÃ©e),parents nÃ©cessaires absents ajoutÃ©s,aucun autre changement y compris APK. BaseExecutable exact,remplacement exact ; aucun second executable,alias/nouvelle link ou payload. mtimeWindow entiers secondes,startâ‰¤end,spanâ‰¤600 ; aucun dÃ©faut automatique.
buildWindow={startedAtMs,completedAtMs},entiers0..MAX_SAFE,ordonnÃ©s,spanâ‰¤600000 ; dÃ©river startSeconds=floor(startedAtMs/1000),endSeconds=floor(completedAtMs/1000). Normatif : Contract+conversion interne,sans expectation/window secondes caller. Futur proof OCI authentifie fenÃªtre/inventaires/config.

Delta={scope:"FILESYSTEM_PREDICATE_MATCH_ONLY"|"CONDITIONAL_ON_AUTHENTICATED_OCI",authority:"NOT_AUTHORIZED",baseMembers,candidateMembers,replaced,addedFiles,addedDirectories,mtimeChangedDirectories}. Quatre arrays de paths distincts,tri ASCII ; replaced=[usr/local/bin/gosu],addedFiles12 exacts,arrays dirsâ‰¤6. Sans corps/config ; scope gÃ©nÃ©rique puis normatif.

V1 rÃ©elle : validatePostgresConfigDelta(baseConfig,candidateConfig,expectedAdditionalLabels,expectedParentImage). Appel aprÃ¨s copie JSON sÃ»re avec {},undefined,profil STRICT_INHERITED_CONFIG_V2 ; comparaison complÃ¨te,Image inchangÃ©. ConfigResult={scope:"CONFIG_PREDICATE_MATCH_ONLY",authority:"NOT_AUTHORIZED",profile:"STRICT_INHERITED_CONFIG_V2"}. Builder incompatible : version/revue distincte,sans self-report.

Codes fixes sans valeurs/stack ; zÃ©ro IO/CLI/spawn/rÃ©seau/archive/framework/deps. Aucune preuve image/fonctionnement/vulnÃ©rabilitÃ©s/publication/Native/admission/support/currentEvidence.

