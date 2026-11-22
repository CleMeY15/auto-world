# TASK-0137 — Essai unique de Camofox Browser

## Demande et périmètre

Le 22 novembre 2026, l'utilisateur demande explicitement d'exécuter Camofox pour vérifier l'accès à la même annonce après l'audit documentaire. La piste email reste en pause. Cet essai distinct utilise la configuration navigateur ordinaire de Camofox, qui est un Firefox modifié ; il n'a pas les mêmes propriétés que le précédent Chromium standard.

Responsable/exécutant : contexte principal GPT-6 Astra Pro ; effort effectif et coût unknown. Reviewer indépendant : acquisition_design_review, contexte Codex distinct, lecture seule. Même tâche et branche spike/0137-leboncoin-autonomous, PR270. Base95f19ebb6656d4055a2d8224a3bc39335478d86f. Checkout exclusif auto-world-acquisition ; aucune ressource produit touchée.

## Plan publié avant code

1. Nouveau workflow de diagnostic limité au dépôt, à cette branche, au chemin du workflow, au parent exact de ce plan et à la première tentative du premier run. Job360minutes, délais fonctionnels courts. Aucun schedule.
2. Installer jo-inc/camofox-browser au commit31376c27db94204ffdc635ae71a7f61328e91a5e avec son package-lock dans un checkout séparé du runner ubuntu-22.04, Node22.23.2. Le serveur REST amont est réellement utilisé ; aucune dépendance ajoutée au produit.
3. Lancer le serveur sur loopback avec clé aléatoire, dossiers temporaires neufs et télémétrie d'incident désactivée. Conserver les défauts de navigation du navigateur amont ; aucune personnalisation d'empreinte, proxy, cookie importé ou interaction humaine automatisée.
4. Un seul appel POST/tabs avec l'URL déjà observée3305814470, puis lectures bornées de snapshot et DOM. Aucun second appel de navigation, clic ou téléchargement de photos séparé. Budget global90secondes après lancement du serveur, navigation30secondes ; fermeture du groupe de processus possédé.
5. Conserver le statut API séparément du httpStatus de destination remonté par Camofox. Ne pas utiliser navigationOk comme preuve d'accès. Reçu public allowlisté et DOM/logs privés bornés, chiffrés avec le mécanisme existant. Le DOM n'est pas le corps HTTP original ; CDP et identités documentaires Chromium ne sont pas revendiqués.
6. Vérifier hors réseau la classification, le nombre d'appels, les erreurs et la confidentialité ; lint ciblé, syntaxe/YAML, Secretlint puis revue indépendante du code figé. Après le run, récupérer les preuves et publier le résultat, même négatif. Pas de fusion, d'activation de source, de base alimentée ni de qualification de récurrence.

## Critères

- listing_page_observed : statut200 de destination remonté, même URL finale et titre/prix visibles dans les sélecteurs de fiche attendus.
- source_refused : statut403/429 ou refus visible ; cause précise inconnue.
- verification_present : demande de vérification observée, sans interaction.
- partial_or_unknown : preuve insuffisante, URL différente, statut inconnu, page incomplète.
- environment_error : serveur/navigateur indisponible avant observation utile.

La comparaison porte sur la classe d'hébergement GitHub ; l'adresse réseau et l'heure ne sont pas contrôlées à l'identique. Un appel REST n'est pas une seule requête réseau : ressources et navigations automatiques restent des comportements du navigateur. Les iframes non couvertes restent une limite explicite.

Revue de cadrage indépendante : favorable à cet essai unique, avec distinctions API/destination, défauts Camofox/Chromium et accès/extraction/récurrence. Les contrats de production ADR-0036 et les preuves historiques restent inchangés.

## État

PLAN_PUBLISHED ; aucune exécution Camofox ni annonce extraite à ce jalon.
