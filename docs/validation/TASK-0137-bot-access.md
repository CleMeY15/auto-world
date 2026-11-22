# AutoFindexBot — dossier préparatoire d'identification et d'accès

Préparé le 22 novembre 2026 pour [TASK-0137](../../roadmap/tasks/TASK-0137-leboncoin-autonomous.md). **Aucun formulaire ni message externe envoyé. Aucune autorisation d'accès obtenue par ce dossier.** Il sert si le parcours automatique normal ne donne pas accès aux annonces ; ce n'est pas une API de catalogue ou un service de scraping tiers.

## Deux décisions distinctes

[DataDome documente](https://docs.datadome.co/docs/bot-authentication) un processus d'identification : User-Agent dédié, mécanisme d'authentification, puis soumission. Sa vérification identifie l'opérateur ; le site conserve sa décision d'accès. Les [comparateurs et fournisseurs de données ne sont pas automatiquement autorisés](https://docs.datadome.co/docs/checklist-before-activating-protection).

Le [formulaire officiel](https://datadome.co/resources/bot-and-ai-agent-verification/) cite explicitement agrégation et comparaison de prix. Il demande des coordonnées professionnelles et la documentation technique. Le délai de revue annoncé de trois à cinq jours ouvrés n'est ni un engagement d'acceptation ni une autorisation de collecte.

## Fiche technique disponible

| Champ | Élément vérifiable / statut |
| --- | --- |
| Projet | AutoFindex, moteur de recherche/comparaison automobile et historique des observations |
| Dépôt | `CleMeY15/auto-world` ; [connecteur](../../connectors/leboncoin-spike/README.md) |
| Identité proposée | `AutoFindexBot` ; le préflight existant emploie `AutoFindexBot/0.1 (+https://autofind.tech)` |
| Identité du test Chromium | UA standard du navigateur, non modifié ; ne pas prétendre que l'identité proposée est déjà déployée dans ce test |
| Logiciel | Node.js 22.23.2, Playwright 1.64.0 et Chromium correspondant, sandbox active |
| Mode | Contexte neuf non persistant ; lecture de champs visibles, extraction et normalisation propres |
| Périmètre effectif | Prototype sur une URL automobile connue par invocation, sans découverte exhaustive activée |
| Limites | Navigation et temps bornés, arrêt sur interaction humaine/refus, aucune résolution de CAPTCHA ou substitution d'identité |
| Données visées | Caractéristiques automobiles, prix, kilométrage et provenance ; références de photos actuellement observables |
| Résultat d'accès établi | Diagnostic HTTP 403 DataDome conservé ; le résultat du parcours complet est suivi séparément dans [la validation](TASK-0137-normal-flow.md) |

La collecte régulière de catalogue, les copies de photos et les archives mondiales sont des objectifs du projet ; leur accès, leur périmètre et leur exploitation ne sont pas attestés par le prototype.

## Informations indispensables avant soumission

- Identité et entité juridique du responsable, email professionnel. Ne pas les déduire du pseudonyme GitHub.
- Domaine officiel à déclarer et URL de documentation consultable par les examinateurs ; `autofind.tech` est le domaine de l'ancien préflight, pas une confirmation du domaine final d'AutoFindex.
- Identité réseau effectivement maîtrisée : adresse fixe/rDNS vérifiable, ou signature Web Bot Auth implémentée. Les plages générales d'un hébergeur ne sont pas une identité exclusive de notre robot.
- User-Agent dédié définitif correspondant à cette documentation. Une chaîne d'UA seule ne prouve pas l'identité.
- Périmètre demandé au site : pages, volume et cadence du pilote, conservation, références ou copie des photos, éventuel VIN, publication et lien vers l'annonce originale. Aucun débit accepté n'est établi à ce jour.

Pour un premier worker propre, une adresse fixe maîtrisée avec identification publique du bot constitue une option documentée. La signature HTTP est une autre option documentée ; choisir et déployer l'une ne produit pas automatiquement une permission du site.

## Texte de finalité prêt à adapter

AutoFindex développe un moteur indépendant de recherche et de comparaison d'annonces automobiles, avec suivi horodaté des prix et des caractéristiques. Notre prototype utilise notre propre collecteur et notre propre normalisation, sans API d'agrégateur. Nous souhaitons faire identifier AutoFindexBot et définir avec chaque opérateur un périmètre d'accès explicite. Le pilote actuel traite une fiche automobile par invocation, conserve la provenance des champs observés et s'arrête après un refus explicite ou une demande de vérification humaine. La découverte exhaustive et la collecte récurrente de production ne sont pas encore activées.

## Orientation auprès du site

Le [canal de contact officiel leboncoin](https://assistance.leboncoin.info/hc/fr/articles/360007576779-Comment-contacter-le-Service-Clients-leboncoin) permet de demander une orientation vers l'équipe compétente pour les comparateurs ou partenaires. Aucun portail garantissant l'autorisation d'un nouveau crawler n'a été établi dans cette recherche.

Joindre uniquement la fiche du bot, la documentation, le périmètre souhaité et le reçu assaini du refus. Ne pas transmettre le corps de challenge, ses paramètres de session ou une clé privée. L'envoi à un tiers et l'acceptation éventuelle de conditions nécessitent une instruction utilisateur distincte ; ce document ne les effectue pas.
