# ADR-0037 — Lire le catalogue PostgreSQL depuis le site privé

Proposition du 26 novembre 2026. La mise en service reste en attente.

Les membres connectés doivent pouvoir rechercher une annonce déjà conservée, ouvrir sa fiche, consulter les photos référencées et revenir aux mêmes résultats. L’accueil bêta reste accessible avant connexion. Les routes du catalogue et les outils privés passent par le contrôle de session existant. [Périmètre de l’accès web](ADR-0035-private-synthetic-web.md)

Le service Next utilise un socket Unix privé pour lire la base `autoworld` avec le rôle `af_rust_export_reader`. Deux vues additives donnent la provenance des données des fiches et des galeries. La décision d’affichage concerne des lots DOM et des exports Rust identifiés. Le lecteur contrôle la révision du registre, la pièce validée, les échéances, les retraits et les lots à chaque requête. La plateforme conserve l’archive brute dans son schéma privé. La recherche et les fiches partagent le vocabulaire de marques et modèles du connecteur. Le prix reste inconnu si le fichier Rust est la seule preuve. Les photos sont des références attribuées à la source. [Contrat de publication](../../packages/source-registry/README.md)

En mode catalogue, les anciennes entrées mènent au catalogue et les API de démonstration sont fermées. Un refus de publication ou une panne déclenche l’état d’indisponibilité. Une recherche sans correspondance présente un état vide. La recette initiale exige de retrouver une annonce admise après connexion et d’en vérifier la provenance. Le contrôle courant permet aussi un catalogue devenu vide après expiration ou retrait. L’activation du mode et son retour arrière relèvent de la transaction de livraison du VPS. [Procédure de bascule](../operations/PRIVATE_CATALOG_RELEASE.md)

## Qualification

Le 26 novembre, les deux vues de provenance ont été ajoutées dans la base existante. Une lecture privée par le rôle du site sur les deux lots prévus a retrouvé 1 022 identifiants distincts sur onze pages, 14 311 références photo et 22 prix vérifiés. La recherche et la relecture d’une fiche correspondent au résultat SQL. Les admissions vides ne donnent aucune ligne. Ces contrôles portent sur le contenu disponible avant mise en service.

Les essais sur des lots synthétiques en PostgreSQL isolé couvrent les lots refusés dans la liste, les recherches et les fiches, les galeries de provenance distincte, les retraits et le repli des vues. Le build web est testé dans Chromium et WebKit sur mobile et ordinateur. La session et le contrôle HTTPS ont été testés sur des comptes et un frontal de recette. Le déploiement du publisher, la recette authentifiée sur le domaine et l’admission des lots par l’opérateur restent ouverts.
