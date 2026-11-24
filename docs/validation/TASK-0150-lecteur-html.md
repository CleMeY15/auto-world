# Essai privé du lecteur HTML AutoFindex · 24 novembre 2026

Objectif du pilote demandé par le porteur du projet : lire des annonces avec notre propre code, sans service de lecture tiers et sans interface de données fournie par les plateformes. Périmètre de développement : outil en ligne de commande et PostgreSQL local d’essai. Le dossier ne contient aucune copie des annonces. La branche est indépendante de l’essai précédent avec les interfaces éditeurs.

| Mesure | Résultat observé |
| --- | --- |
| Une page de résultats Le Parking téléchargée | 2 GET, robots.txt et page HTML en HTTP 200, 466 427 octets en 9,85 s. Aucune fiche ouverte pour produire ce lot. |
| Lecture des cartes | 27 occurrences, 1 répétition, 26 identifiants distincts, 2 incomplets, 24 lignes admises, 0 conflit. |
| Provenances affichées sur ces 24 fiches | 3 mobile.de, 7 AutoScout24, dont 1 commune. Une vérification XPath indépendante retrouve les domaines sur les 9 mêmes fiches. Aucune de ces neuf cartes ne donne de lien individuel direct vers ces éditeurs. |
| PostgreSQL local 17.12, page de résultats | 24 insérées, 24 relues avec vérification des étiquettes, 0 ajoutées au second import. |
| Une autre fiche Le Parking téléchargée individuellement | 2 GET réussis, 129 214 octets en 10,41 s. Prix 20 900 EUR, année de fabrication 2017, compteur 175 759 km. 1 écriture et 1 relecture vérifiée. Les deux documents Le Parking représentent 25 ID distincts. |
| Fiches natives issues de textes déjà indexés | 2 mobile.de + 2 AutoScout24, toutes les 4 complètes et relues dans une base d’essai distincte. Deuxième import à 0 ajout. L’index sert uniquement au contrôle sur des documents déjà disponibles. |
| Accès direct aux fiches natives | Une requête HEAD par site, 403 mobile.de et 200 AutoScout24 France. Les requêtes portaient sur les en-têtes. Aucun corps natif téléchargé par le lecteur dans cet essai. Une vérification de type CAPTCHA n'est pas établie. |
| Relecture de 91 pages archivées | 91 empreintes vérifiées, 2 432 occurrences, 2 043 identifiants distincts, 2 018 lignes complètes avec URL individuelle Le Parking, dont 317 avec une des deux mentions ciblées (12 mobile.de, 308 AutoScout24, 3 communes). 9 des 2 018 lignes n’avaient aucun domaine d’origine vérifié. 0 conflit de valeurs entre identifiants pour les lignes admises. |

La page CLK du nouveau test a été sélectionnée dans l’ancien lot parce qu’elle contenait des mentions des deux plateformes. Les 9 fiches courantes ne constituent donc pas une mesure de couverture. Elles appartiennent à un essai distinct de la relecture des archives. Une fiche présente dans un instantané peut avoir expiré depuis.

Sur les archives, trois identifiants de l’ancien échantillon de 2 000 disposaient uniquement d’un lien de suivi. Le nouveau critère d’URL individuelle les exclut de l’export. Les 317 associations ciblées correspondent à la vérification indépendante du lot historique. Aucune écriture dans la base applicative durant ce nouvel essai.

## Défauts observés et contrôles

Une légende de galerie était initialement interprétée comme titre. Le lecteur privilégie maintenant le bloc du titre. Sur la Mégane, le premier extrait s’arrêtait à la galerie et a été déclaré incomplet. Une seconde partie du même document contenait effectivement le prix, la date et le compteur. Le formatage d’un appel de note accolé à certains prix est pris en charge. Pour les fiches Le Parking, le JSON descriptif intégré peut contenir des retours à la ligne littéraux dans le nom. L’analyse accepte ce format et vérifie l’identité de l’offre avant émission.

La preuve couvre l’extraction et la persistance d’observations. Elle ne mesure ni les nouvelles annonces par jour, ni la disparition des annonces, ni l’accès continu aux deux inventaires natifs. Le téléchargement direct d’une page de résultats n’exige pas de requête par véhicule. Le registre des sources de production est hors périmètre.

La revue indépendante a également reproduit des erreurs sur HTML archivé : fiche Le Parking fournie sans URL explicite, ancien JSON-LD sous un écran de consentement, offre marquée épuisée et identifiant contradictoire. Les corrections ont été rejouées sur les cas synthétiques et la fiche Le Parking réelle. Les 52 tests automatisés du dépôt sont synthétiques et passent en local. Le programme de vérification PostgreSQL crée un document de test, le normalise, l’enregistre, le relit et le rejoue. Les corps d’annonces et les tests sur documents réels restent privés.


## Contrôle complémentaire sur mobile.de

Le 24 novembre 2026 à 16 h 34, heure de Paris, une requête GET ordinaire a été envoyée à la même adresse individuelle que le précédent HEAD avec la même identification AutoFindex. Une seule tentative, zéro redirection et zéro relance. La réponse complète (HTTP 403, text/html, 403 octets en 7,10 s) portait le titre « Access Denied ». Le texte visible ne demandait aucune résolution de CAPTCHA. Ce résultat caractérise la requête depuis cet environnement. Il ne permet pas de déterminer qui a pris la décision de blocage. Aucun champ automobile n’a été lu dans cette réponse.

Le nouveau lecteur de PDF a ensuite été vérifié sur quatre adresses distinctes d’archives publiques hébergées par des tiers. Trois ont rendu de vrais PDF d’annonces, en deux ou quatre pages, avec des années d’impression 2017, 2022 et 2024. Le quatrième hébergeur (cdn.elbila.se) a répondu HTTP 503. Les trois documents reçus ont fourni les huit champs attendus, dont les identifiants et URL mobile.de imprimés. Le lecteur précédent ne récupérait pas les titres et les prix sur les deux archives BMW et Porsche même avec une URL fournie. Il fallait reconnaître les colonnes et les retours à la ligne dans l’URL. Sur l’ALPINA, le prix affiché de 49 990 EUR et le prix HT de 42 008 EUR figurent sur deux lignes distinctes.

Le lot de trois a été écrit dans une base PostgreSQL locale distincte (17.12), relu sur une nouvelle connexion et comparé à la lecture indépendante des documents. Le second import a ajouté zéro ligne. L’empreinte commune des deux relectures est `f342add6c886e523df27c554e06c90804a66deec6b12fc53eb1847f091ed3075`. Les ID sont des identifiants d’annonces historiques et ne démontrent pas que ces annonces sont encore disponibles.

Les deux formats d’archives de navigateur ont passé les essais sur des documents construits pour les tests. Une tentative séparée de sérialisation par Chromium local a échoué au démarrage du navigateur sur une restriction des sockets Unix. Aucun document HTML individuel natif mobile.de n’était disponible dans les pièces locales du précédent essai. Le test avec documents réels porte sur les impressions PDF.

Les 12 annonces portant la mention mobile.de dans les archives Le Parking ont par ailleurs été contrôlées indépendamment. Les 340 liens présents dans leurs cartes n’ont fourni aucune URL native mobile.de. Un libellé d’origine seul ne génère jamais de numéro d’annonce mobile.de. L’accord indiqué pour Le Parking porte sur cette source. Les règles publiées par mobile.de au § 11 de ses conditions du service public couvrent le scraping automatisé. Ce pilote ne met en place aucune collecte du catalogue natif.



## Pilote natif après confirmation de l’autorisation par le porteur du projet

Le porteur du projet a indiqué disposer d’une autorisation de mobile.de pour le scraping du site. L’ancienne commande de démonstration appliquait sa configuration Le Parking et rejetait toute autre adresse avant la première requête. La nouvelle commande mobile utilise l’URL individuelle exacte fournie dans le périmètre du pilote. Elle reste indépendante des API des plateformes.

Essai réel du 24 novembre 2026. À 15:52:49 UTC, le lecteur identifié AutoFindex a lu robots.txt en HTTP 200 puis interrogé une fois la fiche convenue. Son format d’URL est permis par les règles récupérées. La réponse de la fiche était HTTP 403 et contenait une page de 403 octets intitulée « Access Denied ». Le texte visible de l’échantillon intégral ne portait aucune mention de CAPTCHA ou de vérification humaine. Une référence de support exploitable a été relevée et transmise au porteur du projet dans le diagnostic privé. Durée des deux requêtes : 13,02 secondes. Zéro fiche reçue, zéro insertion, aucune relance. Le contrôle SQL a confirmé zéro ligne avant et après dans la base d’essai dédiée. La mesure porte sur une seule URL et un seul environnement ; elle ne démontre pas une politique uniforme pour toutes les annonces, et l’état actuel de cette annonce reste inconnu.

Vérification indépendante dans PostgreSQL 17.12 avec des réponses HTTP et des véhicules synthétiques, sans trafic éditeur. Une fiche individuelle a donné une insertion, une relecture indépendante des huit champs et zéro insertion au rejeu. Dans un second essai, un manifeste de 1 003 lignes a donné 1 000 URL distinctes. Dix fiches ont été écrites et vérifiées avant un 403 simulé sur la onzième. Les 990 URL restantes et le motif d’arrêt ont été conservés. Le lancement suivant a émis zéro requête. Ces lignes de test se trouvent exclusivement dans une base d’essai locale. Aucune donnée native réelle n’a été écrite dans autoworld au cours de ce test.

L’identifiant du document doit être présent dans le HTML et correspondre à l’URL demandée. Un document de refus, une page de liste ou une fiche avec plusieurs identités ne produit aucune observation. Le reçu peut conserver le statut HTTP, l’étape de l’échec, son heure UTC, la présence d’une mention explicite de CAPTCHA et un identifiant de corrélation borné. Les cookies et les corps de refus sont exclus du reçu. Le transport garde son identité et sa route.
