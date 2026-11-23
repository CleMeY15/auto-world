# TASK-0138 — Comparer les outils gratuits de lecture d'annonces automobiles

Date : 23 novembre 2026. Demande utilisateur : « Essaye les tous 1 par un pour 100 annonces pour voir lesquels sont les plus prometteurs. Installe absolument tout ce qui est nécessaire ».

## Objectif

Évaluer de manière équitable et vérifiable les **sept** candidats du dernier inventaire : Jina Reader, Cloudflare Browser Run, etienne-hd/lbc, etienne-hd/lbc-finder, RemiPelloux/lbc-api, D4Vinci/Scrapling, apify/Crawlee. Crawl4AI est inclus comme huitième moteur déjà présenté. Le nombre de **100 annonces est un plafond par candidat**, pas une promesse d'extraction. Arrêt obligatoire à la première réponse refusée (403/429), vérification bloquante, limitation du fournisseur, erreur de session ou défaut d'environnement. Aucun accès à une fiche bloquée par une nouvelle identité, captcha, proxy rotatif ou réponse au contrôle.

Mesurer séparément : logiciel installé / tests hors réseau / premier accès réel / URLs tentées / annonces dont le noyau automobile est réellement extrait / refus et taux de succès / appels gratuits consommés / provenance / temps d'exécution. Le HTTP 200 d'une page de contrôle n'est pas une annonce. Le compteur de 100 n'est jamais rempli avec des fixtures ni de simples candidats découverts. Les résultats de recherche en liste sont distingués des fiches détaillées normalisées.

## Configuration et dépense

- Exécuter sur runners GitHub éphémères et isolés : logiciels officiels dans des environnements Python/Node séparés, versions journalisées, permission GitHub contents read, secrets absents, persistance désactivée ; aucun service en production ni modification de la base privée.
- Outils sans compte (Jina Reader sans clé, outils open source) : installer dépendances, effectuer tests hors réseau, puis une campagne distincte plafonnée à 100 URL réelles observées, rythme minimal de 10 s pour les accès vers la source, un seul appel courant, zéro nouvelle tentative après refus.
- LBC Finder dépend de lbc : bien le tester, mais noter l'absence d'indépendance du moteur de requêtes.
- Cloudflare Browser Run nécessite un Cloudflare Account ID + token et un quota gratuit de 10 minutes/jour : pas de création de compte, prélèvement ni récupération de credentials privés par ce plan. Si non disponible, marquer `credentials_required`, ne pas simuler un test réel.
- Les coûts d'installation consommant seulement le quota GitHub du propriétaire ne sont pas mesurés en euros ; aucune souscription ni lancement de service payant.
- Installation dans les jobs utilisant des versions stabilisées, téléchargement d'un vrai navigateur pour les outils demandant JavaScript ; vérifier au moins un site neutre local ou un contexte factice avant le réseau. Risque supply-chain : pas de privilèges GitHub d'écriture, aucun secret cloud transmis.

## Programme

1. Confirmer les versions, points d'entrée et licences de chaque projet et les contraintes des offres Cloud ; annoter toute dépendance commune et les prérequis manquants.
2. Construire un bench marqué par outil, même jeu de départ de trois URL déjà observées, puis URLs connues et liens de recommandation légitimement exposés. Maximum 100 fiches différentes *par outil*, en conservant les historiques de réussite et d'arrêt ; 10 s entre les navigations en mode sans compte.
3. Tester le traitement correct de réponses HTTP 200 normales, 403, 429, captcha HTML/iframe et erreurs dépendance, les limites de 100, la déduplication, le tri chronologique, les sorties expurgées de toutes données privées de vendeur.
4. Publier et exécuter des workflows GitHub **one-shot**, chacun sur parent de plan figé, un seul run/tentative, 360 min de job mais délai fonctionnel mesuré ; benchmarks à cadence séquentielle. Aucune collecte en arrière-plan programmée.
5. Reprendre les reçus originaux, établir un comparatif `available/install_ok/source_access/complete/blocked/reason` et décider quel moteur permet une intégration *sous réserve d'accord source*.
6. Garder les annonces extraites hors du catalogue produit. Les importer sur le VPS requiert une décision et un droit d'usage distincts.

## Conditions de vérité

Aucun de ces paquets gratuits ne garantit l'accès à leboncoin ou la redistribution. Conditions du site / statut de source inchangés : `not_access_approved`. Un zéro annonce peut venir d'un refus, d'un changement de DOM ou d'un défaut d'installation ; les causes restent séparées. Réussite d'installation != extraction réussie. L'utilisateur a autorisé le benchmark et les dépendances, pas un achat, une connexion privée à un tiers, ni un contournement de CAPTCHA.

Responsable : contexte de coordination du projet ; tests et revue locale/CI indépendants selon disponibilité, le mode `full Codex` du dépôt reste une exigence pour le passage en production. Coût réel et effort modèle : non disponibles.

État initial : PLAN_READY / NO_NEW_TOOL_TESTS_RUN.
