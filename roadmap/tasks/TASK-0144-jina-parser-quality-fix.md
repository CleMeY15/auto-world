# TASK-0144 — Corriger les deux défauts du parseur de cartes

24 novembre 2026 — Suite du run 45353673454, PR #278. Baseline : 300/500 cartes synthétiques strictement exactes. Les 100 prix uniquement libellés et les 100 titres en un mot ont été rejetés.

## Changements
- Accepter un prix de vente correctement libellé « Prix: » ou « Prix : », y compris les espaces Unicode, sans accepter une mensualité comme prix total. Ne pas choisir arbitrairement un prix en cas de montants contradictoires.
- Accepter un titre court s'il est explicitement associé à un lien de fiche automobile dans la carte. Ne pas traiter une simple étiquette ou un titre absent comme une annonce valide. Privilégier le titre lié et éviter de prendre le prix d'une autre carte.
- Conserver les limites, le détecteur de vérification et toutes les règles d'arrêt. Aucun changement de récupération réseau.
- Rejouer le même jeu synthétique déterministe de 500 cartes (cinq variantes, pagination avec recouvrement) et les 14 tests préexistants ; ajouter des tests de non-régression sur prix libellés, titres courts, prix ambigu, financement seul et cartes adjacentes incomplètes.
- Exiger que le rapport confirme 500/500 valeurs exactes et identifiants, zéro association incorrecte ou inattendue dans les pages mixtes, les 70 doublons éliminés et 5/5 scénarios d'arrêt. Le verdict de qualité doit faire échouer le workflow s'il n'est pas atteint.
- Test exclusivement hors réseau sur données fictives. Aucun appel Jina/Leboncoin, aucun contournement de vérification, aucun import en base ni fusion automatique.

## Livraison
PR brouillon et rapport CI expurgé. Comparaison avant/après, signalement des limites hors réseau. Le brouillon de support Jina demeure non envoyé ; la question d'accès live reste indépendante.
