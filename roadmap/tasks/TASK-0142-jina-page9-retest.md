# TASK-0142 — Recontrôle unique de la page 9 dans Jina Reader

Date : 24 novembre 2026. Demande : « Retest maintenu » interprété comme « refais le test maintenant ».

## But
Refaire **une seule lecture** de la 9e page publique des annonces voitures depuis Jina Reader, sans poursuivre la pagination ni modifier le catalogue. Comparer ce résultat au diagnostic précédent (run `45341128165`, HTTP 200, 278 caractères, `keyword_only` car un mot « captcha » présent, 0 carte automobile, réponse SHA-256 `22a8bbe2752e35e3faf2492e00f877aecaeba7b8713ac00fa8322fe0fcd97597`).

## Protocole
- Reprendre exactement `connectors/leboncoin-spike/jina_verification_diagnostic.py` et les tests hors réseau existants depuis la branche `spike/0141-jina-verification-diagnostics`.
- Exécuter **un seul** appel à Jina (page 9), sans cookie, proxy, solveur CAPTCHA, rafraîchissement, changement d'identité ou seconde tentative.
- Mesurer HTTP, type de réponse, marqueurs nommés de contrôle, longueur, SHA-256, présence de liens et de cartes, sans enregistrer texte vendeur/annonces.
- Arrêter et rendre le compte-rendu qu'il soit normal ou suspect ; une répétition de la réponse `captcha` **ne doit pas enclencher** une récupération massive.
- Le corps exact du premier test (run `45259765450`) n'a jamais été conservé et ne peut être comparé.
- Récupérer le nouveau rapport JSON, comparer hash/longueur/règles avec le diagnostic du run `45341128165`; ne pas assimiler une classification `keyword_only` à la preuve d'un CAPTCHA.
- Aucune écriture PostgreSQL et aucun droit de réutilisation/rediffusion inféré.

## Sortie
Un unique workflow GitHub en lecture seule, une PR en brouillon non fusionnée et un artefact JSON expurgé conservé sept jours. Ne pas faire de surveillance automatique.
