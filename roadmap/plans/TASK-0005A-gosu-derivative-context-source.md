# TASK-0005A - Gosu derivative context source

Status: PLAN_ONLY. Source authoring approved; implementation, tests, source review, final-head CI, main CI and delivery pending. No accepted-original read or context operation has occurred in this increment. Image UNBUILT; authority NOT_AUTHORIZED.

Base main25b55ad507c695e6caf9a65caa30afc0c671fe15/treeec4118c0a19c14e70883a062463ca34a06e37c79 follows independently accepted PR169 SOURCE_DONE_ON_MAIN. The 951-file baseline207254/SHA256973a970e4bcfe5ea79478d153883ff48c4aa8acd459a62028c032526a7059b2e freezes948 protected files and3 append-only prefixes.

The frozen plan below is preserved byte-for-byte, including its historical review-pending author label. Its subsequent distinct Critic8616/SHA2565e83dea3bf129db2067262a8dc9044d5d6d67aac0c6dc04cb3bf0fc63a83fff7 accepts CLEAR_FOR_CONDITIONAL_SOURCE_AUTHORING with no findings. Plan13487/SHA25675dfa04a6567d83ccd2787a399da8205c72038bd4fe7da4694a13c66475db6b3 and private stat-only review5745/SHA25680eba1b31f801efd39ed3ce34d0df058813544f867dc7163ade01d11c024e8e2 close source readiness only. No original ZIP/TAR/member bytes were read by planning.

# B0 - contexte Gosu source, revision fermee

ROOT_AUTHOR / CRITIC_REVIEW_PENDING / SOURCE_CONTEXT_ONLY. V1 reste intacte : 10193/aeb42307adf0d57bb31fdb544806f6bdd938d42c959517eee8763087fb8c3ae2. Cette revision remplace ses interfaces et quatre branches ambigues ; les limites V1 non contradictoires restent applicables. Le dernier point architectural annonce par l'architecte est ferme : trois exports, API sans argument, racines fixes, promotion no-replace, verifier TAR independant, tests IO VM existants. Aucune production ni archive n'a ete lue/modifiee par cette revision.

## Prerequis satisfaits et autorite limitee

PR169 est SOURCE_DONE_ON_MAIN : source8081057b3a3f398dba0fe3f8d59e3165ea8ccda9/main25b55ad507c695e6caf9a65caa30afc0c671fe15/treeec4118c0a19c14e70883a062463ca34a06e37c79, CI finale38500544964/main38501946291. Revue livraison7983/87d169cf2b9e9012fffb839e7060974efaa40381380a8a5713e6c969011ff1fa. Baseline source951 fichiers/948 proteges+3append-only : .omx/gosu-derivative-context-source-preedit-v1.json,207254/973a970e4bcfe5ea79478d153883ff48c4aa8acd459a62028c032526a7059b2e.

Actual11 review3643/eb862271418d63846aa44ae989ae7327899e9696b4bf0560510d1d83984a726b, document projection review7784/52161f387ff2d5243805a2ca6c6c91a43ec1accfea6b74a46afb1566d57a4733, preparation-record delivery7294/93c232ca0684e1dac89aa9a56346d11ff910f0a474250015502ae1c7e305e316 restent immuables. Vrai lock candidat7276/34d6affcc89c60fae029831ac9569ca3967e65c542b4ba62817797843f43e031 et son vrai WeakMap handle gouvernent les15entrees. Aucun replay d'anciens consumers/validators/comparators.

Profil derive .omx/gosu-derivative-candidate-context-input-profile-v1.json,2012/f40d826ed38e7fcc0fd90fab4ae7f05b2b8edb47aef39ff01bed8dcb7ea9acf8 ; header observation deja retenue5062/9c94ff4a6a9eaf774fae79a313637cc68c6c0e22891433491e865b006610ee4d. Observation stat-only nouvelle11530/f0ab824310848666b128b5d97f09996a727907ddcb9e61ec33936181caf98f09 et revue5745/80eba1b31f801efd39ed3ce34d0df058813544f867dc7163ade01d11c024e8e2 CLEAR_STAT_ONLY_INPUT_METADATA_FOR_PRIVATE_B0_PLANNING. Ce sont des observations/pins, pas une capacite de build/admission.

## Sept chemins, scope inchange

Nouveaux : scripts/postgres-image/gosu-derivative-context-v2.mjs ; tests/postgres-gosu-derivative-context-v2.test.mjs ; roadmap/plans/TASK-0005A-gosu-derivative-context-source.md ; docs/validation/TASK-0005A-gosu-derivative-context-source.md.

Append-only : docs/decisions/ADR-0015-gosu-compiler-derivative.md ; docs/decisions/README.md ; roadmap/DELIVERY.md. Aucun autre chemin suivi, export/module/CLI/dependance/workflow/lock/publisher/remote/audit/V1/Native/support/currentEvidence. Un module, trois exports et CLI ferme. UI intacte. Un focused branch/PR depuis le main accepte ci-dessus ; plan dans le PR body avant code.

## Interfaces fermees

parseStoredPreparationZipV2(nativeBytes, expectedIdentity) retourne {tarBytes,tarIdentity,profile}. expectedIdentity est exactement {zip:{bytes,sha256},tar:{bytes,sha256},crc32} ; nombres safe positifs et caps, SHA lowercase64, CRC lowercase8. Les tailles sont generiques pour les fixtures, ne conferent aucune autorite. Profil fixe ci-dessous, avec offsets derives des tailles ; seul le materializer exige les identites originales. nativeBytes Buffer/Uint8Array prototypes exacts : copie intrinseque avant hooks, Proxy/SAB/resizable/detached refuses, sans coercition. Records plain/own-data/enumerables/exacts, arrays denses nonProxy, bornes avant alloc/properties/body. Diagnostics fixes sans donnees.

encodeCandidateContextUstarV2(entries) retourne {tarBytes,identity}. Exactly15 entrees dans l'ordre des noms de contextEntries du vrai contrat A,14files/1directory. Chaque record utilise les champs A path,type,mode,uid,gid,mtime,size,sha256,body ; directory sans sha/body. Chemins/types/modes/rootroot/mtime0 fixes ; bodies synthetiques sont permis seulement si leurs size/SHA se recalculent. Cet export est FORMAT_ONLY : il ne pretend pas autentifier le lock ni les bodies originaux. Aucun IO.

materializeCandidateContextV2() : arguments.length===0, aucune option/chemin/callback/env policy. CLI uniquement --materialize (exactement un argument) ; l'import n'execute aucune operation. Les deux exports generiques precedents ne conferent pas de handle/capability au materializer. Le vrai accepted input est derive du lock A et des litteraux fermes ci-dessous. Le retour/recu declare CONTEXT_MATERIALIZED_REVIEW_PENDING, jamais CONTEXT_ACCEPTED/SOURCE_DONE/admission.

## Racines et metadonnees

Original unique : repo determine par fileURLToPath(import.meta.url), exactement ../../ depuis le module, puis .omx/gosu-real-preparation-run38485260984-v5/gosu-preparation-1-original.zip. Aucun cwd arbitraire, chemin caller, second original/fallback. Tous ancetres lstat nonliens/directories, realpath identique ; path/fd ordinaires nlink1, taille exacte105074334, UID/GID1000 observes sous WSL. Ne pas appliquer mode0600 au NTFS original ni deduire une ACL/confidentialite des mode0777 POSIX observes.

Observation WSL : dev70/ino1688849861851243/mode33279/nlink1/size105074334/uidgid1000/mtimeNs et ctimeNs1791935033593555900/birthtimeNs0. Ces valeurs volatiles sont reprises par des snapshots frais, pas hardcodees comme provenance. Avant/pendant/apres lecture comparer toutes surfaces path et fd sans atime : dev,ino,mode,nlink,size,uid,gid,mtimeNs,ctimeNs,birthtimeNs. Path/fd WSL identiques observes ; jamais comparaison dev/ino Windows-WSL. Windows caller garde ses snapshots birthtime V7 et ses checks path/fd independants.

Sortie unique : /home/autoworld/auto-world-private-contexts, root native Linux type ext4 (statfs type0xef53), UID/GID1000 mode0700, aucun ancetre lien/world-write. Child litteral gosu-candidate-context-v2 initialement absent ; mkdir exclusif0700 avec parent FD tenu O_DIRECTORY|NOFOLLOW. Base root doit deja etre creee et revue par un bootstrap prive distinct avant actualcaller ; source/CI ne la creent jamais automatiquement. Aucun outputParent caller. API refuse toute deviation au root fixe et runtime Node22.23.2/Linux uid/euid/gid/egid1000, NODE_OPTIONS/NODE_PATH absents. Inputs/dependances/runtime pins avant IMPORTS et apres sont a la charge du caller prive revu ; le source n'invente pas son propre SHA avant livraison.

Tenir les directory FD et snapshots d'identite avant/apres chaque create/open/link/unlink/fsync ; full guards sur objets immuables, seules variations mtime/ctime/nlink de namespace induites par la transition propre sont explicitement autorisees puis resnapshottees. Aucun chmod/chown d'objet existant, aucun privilege. Root et child nouvellement crees doivent etre physiquement0700/uidgid1000 ; fichiers0600/uidgid1000, aucun lien sauf promotion transitoire controlee. Ne jamais decrire l'ownership physique comme rootroot des membres.

## Profil ZIP repeat1 complet

Single ZIP32 STORED, flags8/method0, signaturelocal04034b50, localVersion20, localCRC/compressed/uncompressed0, DOSdate23885/time48292 identiques local/central. Nom ASCII exact22 gosu-preparation-1.tar, localExtra0. Localoffset0/data52. Signed descriptor signature08074b50 +CRC +twoUINT32sizes, longueur16. Central signature02014b50, madeBy0x032d, needed20, flags/method/date/time identiques, internalAttrs0/externalAttrs0x81800020, diskStart0/localOffset0, extra/comment0. Central68bytes (46+22), EOCD signature06054b50/22bytes, disk0/centralDisk0/entriesOnDisk1/entries1/archiveComment0. Aucun preamble/trailer/ZIP64/extra member/overlap/disk/compression/name fallback.

OriginalZIP105074334/8b6e5b2bf25263eb5d88beb29a14a0ce94f04e84532545b5f4b67c420d0b485c, TAR105074176/60225c765c783733e729694110878d1265dcd5a6f977c3ad8db101cc34bc50d8, CRC4b368a3f. Descriptoroffset105074228/hex504b07083f8a364b004e4306004e4306 ; centraloffset105074244 ; EOCDoffset105074312. Generic fixtures derive these offsets from tar.bytes but retain exact fixed headers/date/name/attributes. Authenticate ZIP SHA/size avant parsing, TAR SHA/size et builtin CRC32 apres copie, avant TAR consumer.

## TAR canonique et preuve independante

Input scanRawUstar du vrai scripts/postgres-image/gosu-derivative-archives-v1.mjs, options strictes et exact28 GOSU_PUBLIC_FILES_V1 du vrai preparer ; aucun semantic revalidation/replay source/module/sumdb/receipt. Selectionne uniquement gosu +11docs ; ne materialise aucun membre.12identites verifiees par contract A. Manifest/recipe generes depuis candidateContractV2(openCandidateLockV2(rawLock)). Pas de faux handle/stub dans le chemin reel.

Output exactement15headers512bytes ; names ASCII <100 sans prefix/trailing slash, directory type5/size0, files type0. Octal zero-padded (mode/uid/gid/dev7digits+NUL, size/mtime11digits+NUL), checksum6octaldigits+NUL+space ; ustarNUL/00 ; uname/gname/link/prefix/reserved tous zero ; dev0 ; uidgid0/mtime0 ; modes fixes0755 gosu/directory,0644autres. Padding payload zero, EOF exactement1024zeros, aucun bloc additionnel. Taille totale derivee des sizes, allocation apres verification des caps ; identite externe recalculable, sans self-hash manifeste.

Verifier sortie distinct par offsets/champs/bytes (sans appel au constructeur de header) : tous champs exacts y compris format numeric/checksum/nameprefix/unamegname/reserved, ordre, bounds,padding,tailleEOF. Puis vrai Seaweed scanRawUstar avec diffId sha256:<hex>, allowHardlinks=false, max15/maxoutput et chunks<=1MiB. Predicate A sur ses vraies metadata et les slices du TAR reel relu. Independance semantic scanner + canonicalbyte verifier ; aucun format OCI presume.

## Lifecycle durable, sans retry

Dans child CNEW, claim.json wx0600 fsync file/close/readback puis fsync child et parent AVANT toute originalbodyread. Claim OPERATING/SOURCE_CONTEXT_ONLY/NOT_AUTHORIZED, date/versions/sourcepins/identites sans bodies. Une tentative utilise un seul child et ne peut jamais etre automatiquement rejouee.

Read original once sur FD O_RDONLY|NOFOLLOW, caps/copies/hash/snapshots ; input ZIP/TAR scan et selection ; encoder ; ecrire context.tar.partial wx0600, complete write/fsync/close ; fsync child. Relire uniquement cette partial avec snapshots/caps/identity, canonical verifier, Seaweed scanner puis vrai A. Pas de finalname avant tous checks.

Promotion linkSync(partial, context.tar) exclusif (EEXIST echoue, aucun rename overwrite), verifier dev/inode/sameFD/root owner/mode et nlink2 exact sur les deux alias ; fsync child. Unlink SEULEMENT la partial propre si meme inode/bytes que valide, verifier finalnlink1 ; fsync child. Fsync final,close et readback final stable exact ; inventory final attendue claim+context (pas de partial). Recu success.json wx0600 fsync/close/readback/fsync child et root. Recheck inputs/code/runtime/caller guards avant acceptance de la tentative ; un recu sans revue independante n'est pas une acceptance.

Toute erreur ecriture/fsync/close/reread/validation/promotion/unlink/dirfsync/recu/recheck : aucun success claimant, code public fixe, FAILED_RETAINED dans failure.json si IO le permet. Failure-receipt failure est aussi retenue par stderr/exit/transcript externe, jamais convertie en PASS. Partial/alias/final/recu deja crees sont conserves ; aucun cleanup/retry. Si une transition tardive laisse success.json ou context.tar, son existence seule n'a aucune autorite : claim+absencefailure+recheck caller+revue independante sont requis. Inventorier les etats partiels exacts dans le resultat externe d'echec.

## Tests, caps et delivery

Tests format synthetiques : ZIP profilcorrect et champs hostiles/caps/CRC/SHA/offset/descripteur/trailer ; renderer quinze donnees synthetiques labelFORMAT_ONLY, bodyhash/metadata/order/nativebacking/getter/proxy/unknown/path/caps rejets. Canonical verifier et vrai Seaweed roundtrip, jamais un faux positif full genuineA.

IO/durabilite : reutiliser le pattern vm.SourceTextModule/SyntheticModule existant, source export public limite3. Acces helper prive par ajout TEST_ONLY au source compile dans le test seulement, ou linker FS virtuel sur chemin failure ; explicitFORMAT_ONLY, ni original ni faux genuineacceptedcontext. Test failures write/filefsync/close/readback/validation/linkcollision/partialunlink/finalfsync/dirfsync/successreceipt; operationlog prouve ordering et retention/noretry/nooverwrite. Relaunch VMflag existant et nonzerochildtests, pas de skip silencieux. Gaps realfilesystem/realpositive restent explicites jusqu'a caller distinct apres sourceDONE.

Caps : ZIP142606336, inputTAR138412032, max28members/67108864member/134217728expanded ; bodies68161536/output69206016,exact15 ; capsA docs262144/evidence1048576/recipe4096. Heap1024MiB/timeout300s/stdoutstderr2097152caller ; RSS mesure seulement. Aucun shell/spawn/network dans le module, aucun Go/gosu/Docker, extraction FS de membre, privilege, registre, Native ou activation.

DoD : targetedWin/Linux ordinaires +A/V1controls ; lint/typecheck/test/build/secrets/audit ; documenter erreurs/rollback/limites et indices publics sans bodies ; independent source/security review ; exact-headCI, merge identical951+4tree, mainCI, SOURCE_DONE_ON_MAIN delivery. Base main avance => nouvelle integration/baseline, jamais supposition. Un vrai original/context positif commence uniquement APRES B0 sourceDONE, bootstrap/output/caller revus. Elevenactuals/eightCI endpoints consommes restent interdits, acteursA retires. ImageUNBUILT/funcvulnNOT_ESTABLISHED/admissionNOT_AUTHORIZED/supportdatesnull ; TASK0005A/0005IN_PROGRESS et dependantes bloquees.
