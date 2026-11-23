# TASK-0139 — Validation Jina Reader en volume, sans import

Date : 2026-11-23. Demandé : « Lets go faire un test grandeur nature avec jina. Si je comprends bien on eu aucun blocage ? C’est juste des données insuffisantes sur certaines fiches ».

## Résultat de référence (rapport JSON run 45224039881)
- Jina sans clé : 100 requêtes, HTTP 200 = 99, HTTP 503 = 1, aucun HTTP 403/429, aucun contrôle anti-bot classé.
- 72 pages avec quatre *indices* automobiles ; 5 partielles ; 23 sans les indices suffisants. Ce ne sont pas 72 fiches validées.
- 22 des 23 sans données ont pourtant répondu HTTP 200. Les causes (fiche retirée, contenu vide, capture incomplète, retour générique) sont indéterminées.
- 346 URL candidates sont signalées dans le benchmark, pas 346 annonces extraites ni 346 articles distincts vérifiés.

## Campagne grandeur nature
- **500 URL maximum**, test en un seul job GitHub Actions éphémère, sans compte Jina, à **10 secondes minimum** entre requêtes et **une seule requête simultanée**. Respecter les limites publiées Jina ; aucun changement d'identité, proxy, CAPTCHA, IP rotative ou contournement.
- Approvisionnement uniquement depuis le jeu de 53 URL déjà observées, puis des liens de fiches automobiles explicitement exposés dans les pages lisibles. Pas de génération d'identifiants, pas de recherche privée ni login.
- Aucun export de contenu brut, coordonnées vendeur, emails, téléphone, photos ou texte descriptif ; métriques et empreintes SHA-256 seulement.
- **Arrêt immédiat** sur 403, 429, vérification/challenge ou erreur nécessitant un contournement. Sur 5xx : enregistrer sans retenter ; stopper après trois erreurs serveur consécutives, ou cinq au total. Limiter à 180 min ; pas de boucle d'essais.
- Distinguer : HTTP 200, 4xx/5xx, page challenge, contenu insuffisant, indices complets, indices partiels, URL observée, doublons de contenu, taux d'indice par champ et sources d'erreur.
- Inclure quelques tests hors réseau (erreur 503, 403, faux positif 200, URL, doublons, arrêt), rapport JSON expurgé en artefact GitHub, conservation sept jours.
- Résultat = qualité technique de lecture d'URL observées ; **pas** de droit de rediffuser les annonces. source_access_approved=false et database_updated=false. Ne pas fusionner automatiquement.
- Une exécution unique sur push du fichier workflow, permissions contents:read, aucun secret. PR distincte en brouillon.

## Critères de qualité
- Les quatre mentions (marque, prix, km, année) sont des indices : elles peuvent provenir de recommandations et **ne valent pas validation de l'annonce principale**.
- Relever séparément la proportion HTTP 200 sans données et le taux de contenus dupliqués.
- Stopper si la majorité des pages cessent de livrer des données (18 pages de catégorie no_vehicle_data/empty sur 20 réponses HTTP 200 récentes).
- Ne jamais étiqueter « zéro blocage » si le rapport a des erreurs ou si l'anti-bot est simplement non détectable.
