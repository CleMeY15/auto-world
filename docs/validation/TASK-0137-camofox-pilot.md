# TASK-0137 — Pilote Camofox sur trois annonces

## Pilote de répétabilité Camofox — plan du 22 novembre 2026

Autorisation utilisateur : « Vas-y on fait ça », après proposition d'un petit pilote multi-annonces et répété. Propriétaire : coordinateur Codex ; implémentation, tests ciblés délégués et revue indépendante en contextes distincts, modèle/effort hérités sans changement demandé (effort exact non exposé). Périmètre TASK-0137, branche existante ; point de départ ff7b9558ba5f0e672619ee77cad2ac7086e42903.

- Figer les trois annonces déjà observées : 3305814470, 3312238672, 3308374007. Deux passages séquentiels, au maximum six ouvertures, 30 secondes entre observations et au moins cinq minutes entre la fin du premier passage et le début du second.
- Réutiliser Camofox 1.19.0 / Firefox 152.0.4-beta.30 au commit amont figé, Ubuntu 22.04 / Node 22.23.2. Une instance temporaire neuve par observation, configuration amont, aucun proxy, cookie importé, interaction CAPTCHA ni retry.
- Paramétrer la cible du lecteur existant sans modifier son comportement par défaut. Chaque identité chiffrée doit lier cible, passage, ordinal, manifeste, révision et run. Une enveloppe par observation ; fragments regroupés par SHA.
- Qualifier l'extraction avec URL exacte, statuts REST/navigation séparés, titre/prix uniques et normalisation déterministe des champs centraux. La troncature du snapshot général reste une limite explicite ; elle ne remplace pas l'examen du DOM structuré. Le reçu historique du premier test reste inchangé.
- Arrêter au premier résultat inexploitable, refus/vérification, erreur d'environnement ou nettoyage non établi ; conserver les tentatives manquantes comme non exécutées. Aucune déduction de retrait depuis un échec.
- Produire un bilan prévu/tenté/extrait, les heures et intervalles mesurés, trois paires possibles et les changements de champs. Une réussite complète prouve uniquement cette fenêtre et ces trois annonces.
- Workflow isolé à déclenchement unique, parent de plan fixé, premier run/première tentative, job 360 minutes avec délais fonctionnels bornés. Aucun horaire durable, registre source, service produit, base ou V1 modifié.
- Tests hors réseau sur identité multi-cible, faux succès, troncature, arrêt global, espacement réel, comparaison des valeurs, fragments et nettoyage ; lint, secrets, syntaxe et revue indépendante avant essai. Vérification des preuves originales après run.
- Ressources : six ouvertures au plus, environ sept minutes de pauses au total, plus installation et délais de navigation. Coût financier non mesuré. Réévaluation au premier échec. Retrait par revert ciblé ; conserver les preuves.

Prérevue indépendante favorable sur ce protocole. Implémentation et essai à venir ; aucun résultat de répétabilité anticipé.

## Résultats

Implémentation et exécution en préparation ; aucun résultat supplémentaire établi.
