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
