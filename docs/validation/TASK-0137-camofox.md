# TASK-0137 — Essai unique de Camofox Browser

## Demande et périmètre

Le 22 novembre 2026, l'utilisateur demande explicitement d'exécuter Camofox pour vérifier l'accès à la même annonce après l'audit documentaire. La piste email reste en pause. Cet essai distinct utilise la configuration navigateur ordinaire de Camofox, qui est un Firefox modifié ; il n'a pas les mêmes propriétés que le précédent Chromium standard.

Responsable/exécutant : contexte principal GPT-6 Astra Pro ; effort effectif et coût unknown. Reviewer indépendant : acquisition_design_review, contexte Codex distinct, lecture seule. Même tâche et branche spike/0137-leboncoin-autonomous, PR270. Base95f19ebb6656d4055a2d8224a3bc39335478d86f. Checkout exclusif auto-world-acquisition ; aucune ressource produit touchée.

## Plan publié avant code

1. Nouveau workflow de diagnostic limité au dépôt, à cette branche, au chemin du workflow, au parent exact de ce plan et à la première tentative du premier run. Job360minutes, délais fonctionnels courts. Aucun schedule.
2. Installer jo-inc/camofox-browser au commit31376c27db94204ffdc635ae71a7f61328e91a5e avec son package-lock dans un checkout séparé du runner ubuntu-22.04, Node22.23.2. Le serveur REST amont est réellement utilisé ; aucune dépendance ajoutée au produit.
3. Lancer le serveur sur loopback avec clé aléatoire, dossiers temporaires neufs et télémétrie d'incident désactivée. Conserver les défauts de navigation du navigateur amont ; aucune personnalisation d'empreinte, proxy, cookie importé ou interaction humaine automatisée.
4. Un seul appel POST/tabs avec l'URL déjà observée 3305814470, puis lectures bornées de snapshot et DOM. Aucun second appel de navigation, clic ou téléchargement de photos séparé. Budget global 90 secondes après lancement du serveur, suivi du nettoyage. Les phases de navigation amont ont chacune un délai de 30 secondes ; notre appel de création attend au plus 40 secondes. Fermeture de l'arbre de processus possédé, y compris les groupes détachés.
5. Conserver le statut API séparément du httpStatus de destination remonté par Camofox. Ne pas utiliser navigationOk comme preuve d'accès. Reçu public allowlisté et DOM/logs privés bornés, chiffrés avec le mécanisme existant. Le DOM n'est pas le corps HTTP original ; CDP et identités documentaires Chromium ne sont pas revendiqués.
6. Vérifier hors réseau la classification, le nombre d'appels, les erreurs et la confidentialité ; lint ciblé, syntaxe/YAML, Secretlint puis revue indépendante du code figé. Après le run, récupérer les preuves et publier le résultat, même négatif. Pas de fusion, d'activation de source, de base alimentée ni de qualification de récurrence.

## Critères

- listing_page_observed : statut200 de destination remonté, même URL finale et titre/prix visibles dans les sélecteurs de fiche attendus.
- source_refused : statut403/429 ou refus visible ; cause précise inconnue.
- verification_present : demande de vérification observée, sans interaction.
- partial_or_unknown : preuve insuffisante, URL différente, statut inconnu, page incomplète.
- environment_error : serveur/navigateur indisponible avant observation utile.

La comparaison porte sur la classe d'hébergement GitHub ; l'adresse réseau et l'heure ne sont pas contrôlées à l'identique. Un appel REST n'est pas une seule requête réseau : ressources et navigations automatiques restent des comportements du navigateur. Les iframes non couvertes restent une limite explicite.

Le statut de navigation est celui du premier goto remonté par Camofox ; il n'est pas authentifié comme statut final corrélé au DOM après une éventuelle navigation automatique. Cette portée est explicitement enregistrée dans le reçu.

Revue de cadrage indépendante : favorable à cet essai unique, avec distinctions API/destination, défauts Camofox/Chromium et accès/extraction/récurrence. Les contrats de production ADR-0036 et les preuves historiques restent inchangés.

## État

Plan publié dans le corps de PR270 puis au commit cc4bdbf26b8438f75e7f115f29cdc7c78624ae31 avant code. Première vérification : 17 tests hors réseau PASS, syntaxe et YAML PASS, ESLint PASS, Secretlint PASS sur 1 693 fichiers. Les tentatives de localisation d'un ancien binaire CLI Secretlint ont échoué ; le script réel du dépôt a ensuite réussi. Aucun navigateur cible lancé à ce jalon.

Prérevue : fermeture insuffisante du seul groupe serveur détectée. Correction : geler et identifier l'arbre via /proc (PID et date de naissance système), terminer aussi ses descendants détachés, vérifier leur disparition ; test réel hors réseau ajouté. Autre défaut corrigé avant vérification : un indicateur de snapshot absent ne signifie plus « non tronqué ». Vérification et revue finales de ces corrections à consigner avant le lancement.

Vérification finale avant publication : 18/18 tests hors réseau PASS, dont le vrai processus enfant détaché ; lint ciblé PASS après suppression d'une initialisation inutile signalée par ESLint ; Secretlint ciblé et diff check PASS. Aucun package TypeScript ou produit modifié, pas de build applicatif déclenché localement. Les gates CI généraux restent distincts de cet essai. Revue indépendante acquisition_design_review : APPROUVÉ pour ce lancement unique ; nettoyage à déclarer vérifié seulement si cleanup.established est true et remaining vaut 0. Aucune exécution Camofox anticipée comme réussie.


## Résultat réel du 22 novembre 2026 — accès ponctuel confirmé

Le [run 45048184974](https://github.com/CleMeY15/auto-world/actions/runs/45048184974), job 137287261221, exécute la source 1821670efe0c5252a5f9fde217b4431814fee72a. Installation, 18 tests hors réseau, lancement du vrai serveur Camofox et conservation des preuves réussis. Fenêtre de l'essai : 17:13:57.570–17:14:04.630 UTC (18:13:57–18:14:04 Europe/Paris), soit 7,060 secondes hors installation.

| Observation | Résultat |
| --- | --- |
| Serveur | Camofox Browser 1.19.0, commit amont 31376c27db94204ffdc635ae71a7f61328e91a5e |
| Navigateur | Manifest Camoufox 152.0.4-beta.30 ; lancement Linux avec Xvfb, défaut amont, une tentative |
| API locale | HTTP 200 |
| Statut de navigation | HTTP 200 du goto initial remonté par Camofox |
| Destination | Même URL dans navigation, snapshot et DOM |
| Véhicule | Porsche 911 Carrera S, année modèle 2021 |
| Prix et kilométrage | 146 990 EUR ; 23 000 km |
| Autres critères visibles | Essence, boîte manuelle, 2 portes, 4 places ; 8 critères au total |
| Photos | 3 références observées ; aucun téléchargement séparé des fichiers image |
| Extraction hors réseau | listing, core_fields_observed=true, issues=[] |
| Nettoyage | Établi : 9 processus suivis, zéro restant |

### Reçu conservateur et observation complémentaire

Le [reçu original](leboncoin-camofox-20261122/public-camofox.json) reste inchangé : outcome=partial_or_unknown et listing_page_observed=false. La cause est le snapshot général tronqué à 8 000 caractères, incompatible avec le critère conservateur de ce classifieur. Le DOM structuré, enregistré séparément, contient un titre et un prix uniques ainsi que les caractéristiques vérifiées. La relecture et la normalisation hors réseau confirment donc un accès ponctuel à l'annonce et une extraction des champs centraux. Ce constat complémentaire ne réécrit pas le reçu et ne qualifie pas la collecte régulière.

### Preuves vérifiées

- 14 fragments récupérés dans les logs authentifiés et recomposés : enveloppe de 30 765 octets, SHA-256 c2acd061ef9d845fa8ea50004e031e2e4e028a755de2eaabbf49e7449285f81c.
- Identité AAD, commit, run, cible, empreinte, taille et tag GCM vérifiés localement par le responsable ; clé privée jamais envoyée au runner ni publiée.
- Empreinte DOM e4d5fdf08349bf405c5da37aef66e040a00d105c7739e7021fa7ad5349fd3a0c vérifiée.
- Artefact GitHub 14764172619 : 24 161 octets compressés, conservation jusqu'au 29 novembre 2026. Une référence de téléchargement a été obtenue ; les octets utilisés pour cette vérification proviennent des fragments de logs, pas du ZIP.
- Reviewer indépendant : recomposition des fragments identique au fichier chiffré, AAD/capture/reçu et DOM concordants, champs normalisés cohérents. Il n'a pas lu la clé privée ni répété la validation du tag GCM. Conclusion APPROUVÉE : accès ponctuel et champs centraux observés ; reçu automatique partiel conservé.

### Portée et suite

L'essai est exécuté par notre code sur un runner GitHub, sans utilisation du navigateur ChatGPT, sans proxy ajouté, cookies importés ou intervention sur une vérification humaine. Il conserve les comportements ordinaires du navigateur Camofox, qui est modifié ; ce n'est pas un Firefox standard. Aucune nouvelle navigation n'a été déclenchée par notre client après la création de l'onglet.

Une annonce a été observée. La récurrence, la découverte de nouvelles annonces, l'exhaustivité, les fichiers photo, la couverture complète des iframes et l'intégration en base ne sont pas qualifiés. La classe d'hébergement est comparable à l'essai Chromium, mais ni son adresse réseau ni son heure ne sont identiques ; on ne peut attribuer causalement la différence au seul navigateur.

Statut de TASK-0137 : OWN_ACCESS_OBSERVED_ONCE / REPEAT_PENDING. Le workflow est à usage unique ; aucun ordonnanceur durable activé, aucune fusion ou activation de source en production.
