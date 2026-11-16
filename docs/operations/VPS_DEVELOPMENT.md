# Développement Auto World sur le VPS

Ce document décrit un environnement de **développement privé** sur Ubuntu 26.04.1 x86_64. Il n'autorise ni mise en production, ni exposition publique, ni données réelles. Le checkout Windows reste disponible tant que la reprise sur le VPS n'a pas été vérifiée.

## Cible et limites

- utilisateur Linux : `autoworld` ;
- dépôt : `/home/autoworld/projects/auto-world` ;
- Node.js 22.23.2 et pnpm 10.15.0 ;
- T3 Code stable 0.1.9 ;
- services, bases, API et aperçus liés à `127.0.0.1` et accessibles depuis le poste par tunnel SSH ;
- ports 3100/3210 réservés à l'aperçu hors ligne, 3111/3211 au prototype persistant lorsqu'ils sont lancés explicitement.

Ne publiez aucun port de développement sur Internet. T3 Desktop se connecte au VPS avec son mode SSH officiel : [Desktop-managed SSH](https://github.com/pingdotgg/t3code/blob/v0.1.9/docs/user/remote-access.md#desktop-managed-ssh). Le dépôt, Codex et les processus restent sur le VPS ; le poste local affiche et pilote la session à travers le tunnel. Le relais authentifié [T3 Connect](https://github.com/pingdotgg/t3code/blob/v0.1.9/docs/user/remote-access.md#t3-connect) permet aussi de joindre T3 depuis le téléphone avec le même compte. Il ne publie pas les ports du prototype et ne transforme pas une adresse loopback en adresse utilisable directement sur le téléphone.

## Préparer la migration

Avant toute copie, inventorier chaque checkout et worktree : branche, révision, fichiers non suivis, modifications non committées et commits non poussés. Préserver les branches d'autres chats et leurs preuves. Produire une sauvegarde Git vérifiable :

- un bundle contenant les références nécessaires ;
- un patch séparé et identifié pour chaque worktree modifié ;
- la liste des fichiers non suivis utiles, copiés séparément ;
- les décisions, preuves et prochaines étapes dans le dossier privé de passation.

Les caches (`node_modules`, caches pnpm, sorties de build et navigateurs de test) sont réinstallés sur le VPS. Les secrets, fichiers d'authentification, volumes de bases, état navigateur et données locales sont inventoriés séparément : leur absence du transfert est explicite. Ne copiez pas globalement les répertoires d'authentification Codex et ne présentez pas une copie de code comme une migration validée.

Le bundle et les patches sauvegardent le code et l'historique Git ; ils ne sauvegardent, ne restaurent et n'activent aucune base de données. Toute reprise d'un volume ou d'un projet persistant suit son runbook propre, après inventaire et vérification de compatibilité. L'absence de reprise est consignée plutôt que compensée par un volume non identifié.

L'historique de référence reste ce chat, complété par la passation privée disponible sur le VPS. Aucun import complet de l'historique dans T3 Code n'est garanti.

### Conversations et plugins

Le snapshot privé des conversations utilisateur Codex inclut les chats archivés, mais exclut sous-agents, raisonnement, outils, authentification et pièces jointes. Son index indique les omissions, les lignes source illisibles et les limites du filtrage de secrets. Vérifiez les empreintes après transfert ; ne publiez ni ces archives ni la base Codex locale. La passation privée `/home/autoworld/migration/HANDOFF.md` donne l'emplacement de l'index accessible aux agents T3.

L'import natif [Welcome de T3 0.1.9](https://github.com/pingdotgg/t3code/blob/v0.1.9/docs/user/welcome-page.md) concerne les sessions locales compatibles et récentes ; il limite les messages conservés et ne reprend pas l'activité complète. Les chemins Windows ne deviennent pas des chemins de projet Linux. Ne réécrivez pas les rollouts ni la base T3 pour fabriquer un import natif : conserver les archives lisibles et commencer les nouveaux échanges sur le VPS.

Les compétences, serveurs MCP, fonctions de Codex App et logiciels Windows sont des composants distincts. La présence d'un `SKILL.md` ne prouve pas que ses outils sont disponibles. Les homes gérés T3 partagent les dossiers de compétences/plugins, mais conservent leur authentification séparée. Réinstaller et vérifier chaque intégration Linux nécessaire, avec connexion personnelle si requise ; ne copier aucun cache de secrets. Le contrôle Windows/Excel/AutoCAD et les outils propres à Codex App ne deviennent pas des outils T3 Linux par copie de fichiers. L'inventaire privé détaille les composants évalués, sans autoriser leur activation globale.

## Installer et ouvrir le projet

Avec `umask 022`, clonez ou restaurez le dépôt dans `/home/autoworld/projects/auto-world`, puis restaurez uniquement les branches et patches inventoriés. Vérifiez leurs révisions avant de poursuivre. Le checkout ne doit être accessible en écriture ni au groupe ni aux autres utilisateurs. Dans le checkout retenu :

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
```

Les deux premières commandes doivent indiquer respectivement `v22.23.2` et `10.15.0`. Une divergence bloque la validation jusqu'à correction du toolchain.

Installez T3 Code 0.1.9 par son mécanisme officiel, puis configurez T3 Desktop pour ouvrir le dépôt distant par SSH. Suivez le [provider Codex de T3 Code](https://github.com/pingdotgg/t3code/blob/v0.1.9/docs/user/providers-codex.md) et le [flux officiel Codex](https://learn.chatgpt.com/docs/auth). L'authentification ChatGPT gérée par T3 et une éventuelle connexion Codex CLI sont deux mécanismes distincts : utilisez seulement celui demandé par le parcours retenu et n'imposez pas une double connexion. Ne copiez pas un fichier `auth.json` depuis Windows.

## Tests natifs sous Ubuntu

Le `/tmp` de l'hôte est un `tmpfs`, alors que certains tests natifs existants exigent un `/tmp` sur ext4, possédé par `root` et doté du sticky bit. Pour ces contrôles uniquement, l'administrateur a installé le wrapper `/usr/local/libexec/auto-world/native-test-namespace.sh`.

Lancez le namespace isolé en administrateur :

```sh
unshare --mount --propagation private /bin/bash /usr/local/libexec/auto-world/native-test-namespace.sh
```

Le wrapper monte l'espace ext4 seulement dans ce namespace, puis abandonne les privilèges vers `autoworld` avant les commandes du projet. Le `/tmp` global de l'hôte reste inchangé. Ne modifiez pas ses permissions et n'assouplissez ni les tests ni leurs assertions pour contourner cette exigence. Le dépôt et ses scripts versionnés n'ont pas été modifiés pour cet environnement.

## Lancer les aperçus

L'aperçu hors ligne sur 3100/3210 demeure arrêté par défaut. Le prototype persistant sur 3111/3211 est lancé seulement quand le travail en a besoin, en suivant [PROTOTYPE_WEB.md](../PROTOTYPE_WEB.md). Ses dépendances restent locales au VPS et ses données sont synthétiques.

Depuis le poste, utilisez un tunnel SSH vers les ports loopback nécessaires. N'élargissez pas l'écoute des applications à `0.0.0.0` pour contourner le tunnel. Conservez le nom exact de tout projet `aw-test-UUID` créé par le prototype et arrêtez-le de manière coopérative.

### Projet restauré et service utilisateur

Le projet persistant restauré est identifié dans la passation privée, pas par une valeur à recopier depuis un autre checkout. Sa restauration ponctuelle utilise les validateurs et le runtime existants, une cible neuve et les mêmes images/plateforme que la sauvegarde froide. L'ancien état Windows n'est pas réécrit : les credentials de la base sont conservés privément, tandis qu'un nouveau propriétaire lié au checkout VPS est généré. PostgreSQL et l'object-store sont restaurés ; OpenSearch est reconstruit explicitement depuis PostgreSQL, Redis reste neuf. Le contrôle éphémère `infra:restore-check` n'est pas détourné pour conserver sa cible.

Un service utilisateur explicitement activé pilote le contrôleur officiel, sans `--seed` :

```sh
systemctl --user status auto-world-prototype.service
systemctl --user stop auto-world-prototype.service
systemctl --user start auto-world-prototype.service
```

Son arrêt coopératif conserve les volumes. Arrêtez-le avant une validation qui doit réserver 3111/3211, puis redémarrez-le explicitement après validation du code construit. Ne lancez pas un second contrôleur sur ces ports. Le service est activé au démarrage avec le maintien du gestionnaire utilisateur ; cela ne vaut pas preuve d'un redémarrage complet du VPS, qui n'a pas été effectué.

La sauvegarde conserve les dates d'observation d'origine. Un avertissement de projection ancienne est attendu pour cette fixture conservée ; ne réimportez pas les données et ne modifiez pas les dates pour masquer cet état. Favoris et listes restent propres au navigateur et ne sont pas synchronisés automatiquement entre téléphone et PC.

## Vérifier la reprise

La validation commence sur un checkout propre et avec les dépendances installées par lockfile. Exécutez les contrôles prévus par le dépôt pour le périmètre migré : lint, typecheck, tests, build, puis contrôles navigateur Chromium et WebKit adaptés au parcours concerné. Lancez les services réels nécessaires lorsque le test prétend valider le prototype persistant.

Consignez les commandes, révisions, résultats et exclusions dans le [checkpoint de validation](../validation/VPS_DEVELOPMENT.md). Un échec, une exclusion nouvelle, un contrôle non exécuté ou un service non lancé reste une limite ; il ne devient pas un succès par la seule présence du code sur le VPS. La Definition of Done et les preuves propres à chaque tâche restent applicables.

## Retour arrière

En cas d'échec de reprise, arrêtez proprement les processus et projets VPS identifiés, puis reprenez le développement depuis le checkout Windows conservé. Ne lancez ni `git reset --hard`, ni prune Docker, ni suppression globale de volumes ou de worktrees. Les bundles, patches et preuves d'inventaire restent conservés jusqu'à comparaison réussie des révisions et validations attendues.
