# Rapport de validation réelle — AutoFindex / TASK-0145

**24/11/2026 — workflow [45359828265](https://github.com/CleMeY15/auto-world/actions/runs/45359828265), PR [#280](https://github.com/CleMeY15/auto-world/pull/280).**
Verdict : **réussite du parseur sur données historiques réelles reformatées ; acquisition Jina/Leboncoin en production NON VALIDÉE.**

## 1. Résultats des trois périmètres

| Périmètre | Résultat observé | Conclusion |
|---|---|---|
| Connecteur officiel Leboncoin, recherche live, 24/11 | 100 résultats affichés sur 811 129 annoncés (491 004 pro, 320 125 particuliers) | Accès par le connecteur OK ; les champs des 100 véhicules ne sont pas exposés à ce test. Aucune extraction Jina à comptabiliser. |
| Jeu synthétique précédent, run 45359318416 | 500/500 valeurs et ID exacts | Baseline contrôlée. |
| Jeu réel historique CC0, API publique Kaggle, run 45359828265 | 500/500 lignes traitées, 500/500 valeurs et ID **de test** exacts | Robustesse aux valeurs réelles testées ; pages et titres reconstruits, pas de capture live Jina. |

## 2. Source, protocole et reproductibilité

- Source : [Aditya — 100,000 UK Used Car Data set](https://www.kaggle.com/datasets/adityadesai13/used-car-dataset-ford-and-mercedes), licence déclarée CC0 ; anciennes annonces UK, données nettoyées par le producteur, non représentatives du marché actuel français.
- API publique officielle : téléchargement en une tentative, HTTP 200, ZIP de 1 152 744 octets, durée 0,56 s. SHA-256 : `1f1b849d2bf44d084cbc1306477cfec878d7b713dc38db93dcffbea86f9371f5`.
- Échantillon déterministe seed 20261124, 9 marques : Audi, BMW, Ford, Hyundai, Mercedes-Benz (56 chacune), Skoda, Toyota, Vauxhall, Volkswagen (55 chacune). Total 500.
- Les valeurs historiques servent de vérité de test : titre reconstruit à partir de marque/modèle, prix GBP converti avec facteur fixe **de test** 1,15 (pas un taux du jour), miles convertis en km à 1,609344, arrondi entier. Identifiants et URL de carte artificiels, jamais interrogés.
- 5 variantes de mise en forme, 100 observations chacune ; 15 pages Markdown reconstruites, 40 cartes par page et recouvrement de 5. Aucun accès à Jina ni au site Leboncoin dans ce workflow. Aucun enregistrement du contenu brut dans GitHub ni import PostgreSQL.

## 3. Mesures réellement obtenues

| Indicateur | Résultat |
|---|---:|
| Enregistrements sources sélectionnés / valides | 500 / 500 |
| Enregistrements sources invalides | 0 |
| Titres, prix, années, km, ID de test tous exacts | 500 / 500 |
| Cartes observées (avec répétitions) | 570 |
| Doublons d'observations éliminés | 70 |
| ID de test absents / inattendus | 0 / 0 |
| ID avec association incorrecte observée | 0 |
| Cartes partielles | 0 |
| Tests unitaires de régression | 22 / 22 |
| Scénarios de cartes malformées rejetées | 5 / 5 |
| Scénarios d'arrêt respectés | 5 / 5 |
| Erreurs de ce replay consignées | 0 |
| Durée du script de validation | 0,873 s |
| Validation stricte | true |

Les 15 requêtes sont **simulées**, et les 0,873 secondes ne mesurent pas le débit Jina en production.

## 4. Registre des échecs connus et des risques non levés

| Référence | Incident / risque | Observation | Impact / conduite |
|---|---|---|---|
| Run 45224039881 | HTTP 503 Jina | 1/100, 72 indices complets, 5 partiels, 22 HTTP 200 insuffisants | Ancienne classification confondait erreurs serveur et données manquantes. |
| Run 45242287040 | Timeout | Arrêt à 196 tentatives, 195 HTTP 200, 131 indices complets | Objectif 500 non atteint ; délai réseau et perte de progression possibles. |
| Run 45259765450 | Signal de vérification | 271 cartes distinctes estimées en 8 pages, 9e réponse HTTP 200 signalée | Arrêt ; HTTP 200 du fournisseur ne prouve pas l'accès à la source. |
| Runs 45341128165 / 45341849651 | Réponse courte répétée | 278 caractères, mot captcha une fois, empreinte identique, 0 carte et 0 lien | Cause amont ou fournisseur inconnue. Pas de preuve de CAPTCHA interactif, pas de relance derrière le signal. |
| Run 45353673454 | Défauts du parseur | 200/500 fixtures rejetées (prix libellé, titre court) | Corrigés et retestés dans PR #279. |
| Run 45359318416 | Contrôle de qualité | 500/500 fixtures exactes, 22/22 tests | Ne valide que les formats couverts. |
| Contrôle officiel live du 24/11 | Champs des résultats non transmis au test | 100 résultats affichés, données individuelles indisponibles dans la réponse machine | Impossible de comparer titre/prix/année/km des 100 annonces au parseur. Ne pas traiter comme échec d'accès. |
| Run 45359828265 | Valeurs réelles historiques | 0 erreur parmi 500 lignes reformatées | Pas de preuve de fidélité au vrai Markdown Jina. |
| Risque restant | Variation du rendu Jina, formats non couverts | Pas de capture native dans ce run | Tester sur un échantillon autorisé de Markdown natif avec vérité de terrain. |
| Risque restant | Rejet 403/429, défi ou contenu suspect | Scénarios simulés : arrêt respecté 5/5 | Conserver arrêt, consigner état et reprendre seulement avec accès autorisé. |
| Risque restant | Données manquantes, prix contradictoires, association de cartes | Tests ciblés passent ; nouveaux formats possibles | Rejeter ambiguïtés, mesurer les écarts par champ, ne pas inventer de valeur. |
| Risque restant | Identité et dédoublonnage des annonces réelles | Le jeu UK ne fournit pas les IDs d'annonces ; IDs de test artificiels | 70 doublons de replay ne démontrent pas la déduplication cross-site ou la stabilité des IDs réels. |
| Risque restant | Compteur d'appels | Le code historique incrémente le compteur après réception ; timeout peut être exclu de total_requests | Distinguer tentatives, réponses reçues et échecs réseau dans les prochaines métriques. |
| Risque restant | Licence et accès production | Aucun droit de collecte/republication Leboncoin établi | Flux avec autorisation contractuelle requis ; pas d'import en production. |

## 5. Conditions de sortie avant production

1. Obtenir une source dont l'accès automatisé et l'utilisation sont autorisés, ou un export fourni par une partie habilitée.
2. Recevoir un échantillon natif de 500 annonces, avec références stables et champs attendus vérifiables ; mesurer les champs et les refus séparément.
3. Mesurer temps, quotas, taux de champs valides, changements d'ID et doublons sur cet échantillon ; aucune poursuite après signal de protection.
4. Demander à Jina la nature de la réponse de 278 caractères via le brouillon de support existant, non envoyé. Pas de demande de contournement.

**Pièce primaire :** artefact GitHub `autofindex-real-data-validation` ID 14903866946, rapport `real-data-validation.json`. PR en brouillon, aucune fusion ou modification production.
