# TASK-0137 — Continuité de session et limites du diagnostic d'accès

## Objet et statut

22 novembre 2026. L'utilisateur demande une lecture régulière de l'ensemble des annonces. L'audit identifie un défaut possible de continuité du contexte entre deux fiches ; il ne démontre pas la cause du refus HTTP 403. **LOCAL_VALIDATED / INDEPENDENT_REVIEW_APPROVED / SOURCE_ACCESS_UNPROVEN**. Les 22 annonces déjà importées et leur reçu restent rattachés au [lot historique](TASK-0137-batch100.md).

Responsable : contexte Codex principal, GPT-6 Astra Pro annoncé ; effort/coût effectifs non exposés. Audit et réalisation du module local dans des contextes Codex distincts ; revue indépendante en lecture seule. Base : `7b611d66bafeecb9d6220d3e8ba4d92d4bfbab91`, PR270. Plan et adaptation publiés dans la PR avant modification. Propriétés de fichiers séparées, qualité sérialisée, aucune nouvelle requête leboncoin pour ce changement.

## Ce que les preuves permettent de conclure

- Le lot direct comporte 22 documents initiaux HTTP 200. Entre fin de capture et ouverture suivante : minimum 10 000 ms, médiane 10 001 ms, maximum 10 003 ms. Ces valeurs décrivent des navigations commandées, pas toutes les requêtes HTTP déclenchées par les pages.
- Le refus de reprise commence 14 min 17,304 s après la fin de la 22e capture, sur la première fiche d'une nouvelle exécution et une URL différente. Aucun seuil de 22 annonces, bannissement d'IP ou insuffisance du délai de dix secondes n'est établi.
- Les versions sont épinglées et les modules de navigation/lecture sont identiques dans les deux runs. Les preuves ne conservent pas l'IP de sortie, l'empreinte réellement générée, ni un identifiant de BrowserContext permettant d'établir leur identité entre les runs.
- Le compteur `creation_calls` mesure un appel à l'API locale de création d'onglet. Images, scripts, requêtes JavaScript, cadres et redirections ne sont pas dénombrés. Une lecture DOM ponctuelle sans signal ne prouve pas l'absence de tout contrôle pendant le chargement.

Les sources DataDome décrivent des signaux de navigateur, requêtes, comportement et réputation réseau ; [Device Check](https://docs.datadome.co/docs/device-check) peut intervenir dès les premières requêtes. Les [journaux enrichis](https://docs.datadome.co/docs/logs-integration) exposant la règle déclenchée sont destinés au backend/CDN du site ; leur disponibilité côté visiteur n'est pas établie. [Modèles de détection](https://docs.datadome.co/docs/threat-detection). Ces informations cadrent le diagnostic, sans révéler la décision appliquée à notre run.

## Défaut concret dans le cycle de vie local

Notre voie historique ferme le dernier onglet après chaque fiche, puis attend avant la suivante. Dans Camofox épinglé au commit `31376c27db94204ffdc635ae71a7f61328e91a5e` :

1. [DELETE /tabs/:tabId](https://github.com/jo-inc/camofox-browser/blob/31376c27db94204ffdc635ae71a7f61328e91a5e/server.js#L7282-L7303) ferme la page et supprime son groupe s'il est vide.
2. Le [reaper périodique](https://github.com/jo-inc/camofox-browser/blob/31376c27db94204ffdc635ae71a7f61328e91a5e/server.js#L7705-L7751) ferme les sessions sans onglet ni page réservée à son tick de 60 secondes. Il ne garantit pas soixante secondes de grâce après la fermeture du dernier onglet.
3. [closeSession](https://github.com/jo-inc/camofox-browser/blob/31376c27db94204ffdc635ae71a7f61328e91a5e/server.js#L1559-L1567) ferme réellement le BrowserContext ; [getSession](https://github.com/jo-inc/camofox-browser/blob/31376c27db94204ffdc635ae71a7f61328e91a5e/server.js#L1579-L1682) en recrée un à la demande suivante s'il a disparu.

Conserver les mêmes userId/sessionKey ne prouve donc pas une session continue. Sans journaux de création/destruction, nous ne prétendons ni que cette destruction s'est effectivement produite pendant les 22 lectures, ni qu'elle a causé le refus suivant.

## Correction retenue

Une nouvelle voie `session-known-details` conserve un onglet local vide pendant le lot. `POST /tabs` sans URL ne navigue vers aucun site ; un marqueur propre est posé sur cette seule page locale. Chaque fiche garde son cycle historique d'ouverture, lecture et fermeture. Le marqueur et l'URL locale sont vérifiés avant et après la lecture ; une garde perdue arrête le lot sans recréation. Deux onglets possédés au maximum : la garde locale et la fiche en cours. La garde est fermée en fin de lot, puis les processus possédés sont arrêtés et contrôlés.

L'option de naviguer dans le même onglet a été écartée avant code : l'API amont de navigation peut remplacer une page morte et réessayer la navigation. La garde locale permet de conserver l'API d'ouverture déjà utilisée et de vérifier explicitement la continuité entre les opérations.

Le manifeste est distinct ; les trois anciens manifestes et leurs empreintes restent inchangés pour rejouer les preuves antérieures. Plafond de 100 fiches, dix secondes minimales, échéance de 45 minutes, validation des URL, conservation au fil de l'eau et arrêt sur refus/contrôle obstruant restent en place. Aucun workflow n'active cette nouvelle voie. Les compteurs de garde n'établissent pas le nombre de requêtes réseau, l'absence de détection ni la stabilité de la source.

## Vérifications et limites

Vérifications locales sur Node 24.22.3 : **117 tests réussis, 0 échec, 0 exclusion**, dont 17 cas de garde et 5 cas d'intégration supplémentaires aux 95 tests historiques. La simulation couvre le nettoyage des sessions vides, la conservation de l'état au-delà d'un tick, l'arrêt avant la prochaine fiche si la garde disparaît, une perte après capture, les entrées invalides, les erreurs de lecture, les fermetures et la concurrence. L'intégration conserve l'arrêt au premier refus et les données qualifiées antérieures à une perte. Les empreintes historiques restent vérifiées par leurs régressions existantes.

Lint final réussi sur les quatre modules/tests modifiés. Une initialisation locale inutile a été signalée au premier passage, puis supprimée ; les 115 tests de cette première proposition ont été rejoués après cette correction. Une entrée `null` a aussi été rejetée explicitement avant le premier passage de tests, avec régression dédiée.

La revue indépendante a ensuite relevé une perte de garde avant navigation qui pouvait être comptée comme une fiche ouverte et laisser une continuité globale à tort positive. Correction : erreur annotée, compteur séparé `pre_navigation_failures`, aucune fiche ouverte/rejetée ajoutée avant le début réel de l'observation, continuité globale invalidée. Si un refus source et une perte de garde sont constatés ensemble après une fiche, le refus garde sa priorité dans le verdict de page et `runBatch`, et la perte reste explicitement enregistrée. Le nettoyage final peut ensuite devenir le motif d'arrêt global s'il n'est pas confirmé ; les preuves de page et indicateurs conservent les deux constats. Deux régressions couvrent ces chemins ; les 117 tests et le lint finaux passent après correction.

Pas de modification du parseur, du stockage, des workflows ni du runtime historique. Secretlint, diff et quatre liens relatifs vérifiés. La revue indépendante finale approuve le code corrigé et les limites documentées ; aucune validation du moteur réel ou de Node 22 n'est déduite de ces tests locaux. La revue porte sur les blobs `11bab710f5b02aad444361766dc091cc45df3479`, `459dce831a219c4f4f053591ba9597bb7c134aad`, `202bc1bb30caab6a9e91243924676b2bce7ec924` et `a68868b6dd802c311e5ad64434a4d53126487022`, respectivement pour l'orchestrateur, son test, la garde et son test.

Cette simulation ne lance pas Firefox/Camofox et n'est pas un test navigateur réel. L'accès régulier et la découverte exhaustive du catalogue ne sont pas validés. Les recommandations forment un échantillon partiel ; un accès réussi aux fiches ne démontre pas l'énumération complète du catalogue.

Retour arrière : retirer la nouvelle route, son module et ses tests par revert ciblé. Les voies historiques, données importées et services existants conservent leur état. Prochain résultat à établir séparément : continuité réelle dans le moteur épinglé sur un environnement contrôlé, puis diagnostic de source fondé sur des mesures réseau suffisantes.
