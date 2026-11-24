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
