# Développement Auto World sur le VPS

Ce document décrit un environnement de **développement privé** sur Ubuntu 26.04.1 x86_64. Il n'autorise ni mise en production, ni exposition publique, ni données réelles. Le checkout Windows reste disponible tant que la reprise sur le VPS n'a pas été vérifiée.

## Cible et limites

- utilisateur Linux : `autoworld` ;
- dépôt : `/home/autoworld/projects/auto-world` ;
- Node.js 22.23.2 et pnpm 10.15.0 ;
- T3 Code stable 0.1.9 ;
- services, bases, API et aperçus liés à `127.0.0.1` et accessibles depuis le poste par tunnel SSH ;
- ports 3100/3210 réservés à l'aperçu hors ligne, 3111/3211 au prototype persistant lorsqu'ils sont lancés explicitement.

Ne publiez aucun port de développement sur Internet. T3 Desktop se connecte au VPS avec son mode SSH officiel : [Desktop-managed SSH](https://github.com/pingdotgg/t3code/blob/v0.1.9/docs/user/remote-access.md#desktop-managed-ssh). Le dépôt, Codex et les processus restent sur le VPS ; le poste local affiche et pilote la session à travers le tunnel.

## Préparer la migration

Avant toute copie, inventorier chaque checkout et worktree : branche, révision, fichiers non suivis, modifications non committées et commits non poussés. Préserver les branches d'autres chats et leurs preuves. Produire une sauvegarde Git vérifiable :

- un bundle contenant les références nécessaires ;
- un patch séparé et identifié pour chaque worktree modifié ;
- la liste des fichiers non suivis utiles, copiés séparément ;
- les décisions, preuves et prochaines étapes dans le dossier privé de passation.

Les caches (`node_modules`, caches pnpm, sorties de build et navigateurs de test) sont réinstallés sur le VPS. Les secrets, fichiers d'authentification, volumes de bases, état navigateur et données locales sont inventoriés séparément : leur absence du transfert est explicite. Ne copiez pas globalement les répertoires d'authentification Codex et ne présentez pas une copie de code comme une migration validée.

Le bundle et les patches sauvegardent le code et l'historique Git ; ils ne sauvegardent, ne restaurent et n'activent aucune base de données. Toute reprise d'un volume ou d'un projet persistant suit son runbook propre, après inventaire et vérification de compatibilité. L'absence de reprise est consignée plutôt que compensée par un volume non identifié.

L'historique de référence reste ce chat, complété par la passation privée disponible sur le VPS. Aucun import complet de l'historique dans T3 Code n'est garanti.

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

## Vérifier la reprise

La validation commence sur un checkout propre et avec les dépendances installées par lockfile. Exécutez les contrôles prévus par le dépôt pour le périmètre migré : lint, typecheck, tests, build, puis contrôles navigateur Chromium et WebKit adaptés au parcours concerné. Lancez les services réels nécessaires lorsque le test prétend valider le prototype persistant.

Consignez les commandes, révisions, résultats et exclusions dans le [checkpoint de validation](../validation/VPS_DEVELOPMENT.md). Un échec, une exclusion nouvelle, un contrôle non exécuté ou un service non lancé reste une limite ; il ne devient pas un succès par la seule présence du code sur le VPS. La Definition of Done et les preuves propres à chaque tâche restent applicables.

## Retour arrière

En cas d'échec de reprise, arrêtez proprement les processus et projets VPS identifiés, puis reprenez le développement depuis le checkout Windows conservé. Ne lancez ni `git reset --hard`, ni prune Docker, ni suppression globale de volumes ou de worktrees. Les bundles, patches et preuves d'inventaire restent conservés jusqu'à comparaison réussie des révisions et validations attendues.
