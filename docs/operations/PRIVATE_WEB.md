# Préparer puis activer l’accès privé sur autofind.tech

**État initial : hors ligne.** Lot TASK-0130 pour srv2160688.hstgr.cloud, Ubuntu 26.04. Le parent coordonne le terminal administrateur Hostinger. Le build des rapports sur 3129 et les services existants restent en loopback. [Décision et périmètre](../decisions/ADR-0035-private-synthetic-web.md).

## Gates avant toute écoute publique

1. Accepter le contrat ADR-0035 et les revues de sécurité, UX et qualité des sources PR/main. Consigner le SHA intégré retenu de TASK-0130 **et** TASK-0129, le lockfile, le SHA de la fixture/API offline 3210, son mainteneur et sa disponibilité. La source de rapports évaluée pour la préparation est [PR 260](https://github.com/CleMeY15/auto-world/pull/260). Vérifier que le mode offline sert les annonces B1/B2 et les rapports depuis ce build. Un build sans rapports échoue au précontrôle.
2. Examiner les avis et mises à jour de sécurité du frontal et des dépendances réellement exécutées. Vérifier l'origine des paquets Ubuntu, versions, support/couverture des mises à jour, digests et politique de maintenance, y compris pour les paquets Universe. Bloquer si un problème critique applicable reste sans traitement accepté. Qualifier la frontière indépendamment de TASK-0005. Réserver le domaine entier au site privé, sans ancien cache/service worker ni autre application sur cette origine.
3. Confirmer en lecture seule DNS A **et** AAAA pour ce VPS, ports 80/443 libres sur les deux familles, pare-feu IPv4/IPv6, comptes système, chemins et unités disponibles, droits de lecture et plan d'arrêt. Ne réutiliser ni proxy partagé, ni service par défaut, ni compte système déjà employé ailleurs. Seuls SSH selon la politique de l’hôte et le frontal prévu peuvent être accessibles. Identifier qui renouvelle le certificat et supervise les erreurs. Pas d'intervention hPanel dans ce lot.
4. Exécuter la recette loopback ci-dessous sur la source intégrée. Puis tester les unités avec leurs vrais comptes, permissions et certificat sur loopback avant de les autoriser sur Internet. Compte temporaire retiré, preuve de retrait vérifiée. Obtenir le feu vert du parent pour les deux adresses. L'accès nécessite un identifiant individuel dès la première lecture.

## Répéter sans root

Sur la machine de test, il faut Node 22.23.2, pnpm 10.15.0, Chromium/WebKit Playwright du lock, openssl, Python avec les paquets Ubuntu python3-django et python3-gunicorn, python3-pexpect pour tester la saisie masquée et le binaire nginx avec auth_request. Pour éviter toute installation système, télécharger par APT les paquets signés `nginx python3-django python3-asgiref python3-sqlparse python3-gunicorn python3-packaging` puis les extraire par `dpkg-deb -x` dans un préfixe temporaire personnel. Exporter PYTHONPATH vers son sous-répertoire usr/lib/python3/dist-packages et PRIVATE_WEB_NGINX vers usr/sbin/nginx dans ce préfixe. Les services de distribution ne sont jamais démarrés par cette méthode.

Depuis la racine du dépôt, en présence de l'API synthétique offline sur 127.0.0.1:3210 (sans redémarrer son propriétaire) :

```sh
pnpm install --frozen-lockfile
NEXT_PUBLIC_PRIVATE_WEB=1 pnpm exec turbo run build --filter=@auto-world/web
PRIVATE_WEB_REQUIRE_REPORTS=1 python3 infra/private-web/test/stack.py
```

La recette principale de cette branche peut être exécutée avant intégration de TASK-0129 en omettant PRIVATE_WEB_REQUIRE_REPORTS. Le gate d'activation l'exige à 1. Le test utilise des ports loopback temporaires, un certificat local, deux sockets et une base éphémère. PRIVATE_WEB_EVIDENCE peut désigner un répertoire de captures. Ne jamais réutiliser la base de test.

La page publique et la connexion servent le globe et le logo AutoFindex depuis le même hôte. Les deux visuels proviennent de la présentation du projet. Le test navigateur vérifie leur décodage, l’accès au catalogue et les six étapes de la feuille de route avec et sans JavaScript. [Présentation AutoFindex](https://autofindex-lancement-terre.paris-clement.chatgpt.site/)

## Staging par l’administrateur

Utiliser un shell root **uniquement pour la préparation hôte**, sans exécuter de code de build sous root. Partir d'une copie fraîche de la révision revue conservée sous un chemin appartenant à root, parents inclus. Contrôler la provenance avant installation. Les instructions suivantes supposent des destinations neuves ; si elles existent déjà, inventorier leur propriétaire et passer par le retour arrière/mise à jour ciblée. Aucune copie depuis un répertoire de travail modifiable par autrui pour installer une commande root.

- Préparer trois comptes système sans login, chacun avec son groupe homonyme, `aw-private-auth`, `aw-private-product`, `aw-private-edge`. Installer les paquets Django et Gunicorn Ubuntu qualifiés. Ne pas installer/démarrer un nginx de distribution qui pourrait écouter avant les gates. Extraire le paquet nginx validé par APT dans un répertoire temporaire puis installer **son binaire uniquement** sous /opt/aw-private-web/bin/nginx. Programmer la reprise de cette copie à chaque mise à jour de sécurité et rejouer les tests avant redémarrage.
- Dans /opt/aw-private-product préparer une **copie dédiée** du monorepo sur le SHA intégré ; construire comme utilisateur de build non privilégié avec le lockfile et la commande ci-dessus. Conserver workspace, node_modules, paquets construits, sources de configuration et apps/web/.next. Installer Node vérifié dans /opt/aw-private-node. Le build privé dépend de NEXT_PUBLIC_PRIVATE_WEB=1. Geler ensuite l’artefact et son manifeste en lecture seule pour les trois identités de service, vérifier les liens pnpm et leurs cibles, sans dépendance vers /home, caches ou worktrees partagés. Suivre SHA et empreintes avec la version de Node et le BUILD_ID. Aucun processus Next dev sur ce chemin. Le compte produit n'a aucun droit de lecture sur la base d’authentification ou la clé TLS.
- Préparer /etc/aw-private-web/fullchain.pem lisible et /etc/aw-private-web/privkey.pem root 0600, par un canal local de certificats de confiance autorisé pour autofind.tech. Pour ne rien publier pendant le staging, utiliser un certificat déjà provisionné ou une validation DNS séparément autorisée par le parent. Vérifier nom, dates, chaîne et correspondance de clé. Tester renouvellement et redémarrage **ciblé** de aw-private-edge (systemd reprend LoadCredential au redémarrage). Garder tout secret hors terminal partagé, Git, captures et chat.
- Depuis **la racine de la copie revue appartenant à root**, installer les fichiers suivants, sans modifier /etc/nginx ni le service partagé :

```sh
install -d -m 0755 /opt/aw-private-web/templates /opt/aw-private-web/bin
install -m 0644 infra/private-web/*.py infra/private-web/product.cjs infra/private-web/nginx.conf /opt/aw-private-web/
install -m 0644 infra/private-web/templates/access.html infra/private-web/templates/launch.html infra/private-web/templates/brand.css /opt/aw-private-web/templates/
install -d -m 0755 /opt/aw-private-web/launch
install -m 0644 infra/private-web/launch/launch.js infra/private-web/launch/launch.webp infra/private-web/launch/wordmark.webp /opt/aw-private-web/launch/
install -m 0755 infra/private-web/manage infra/private-web/preflight.sh infra/private-web/render-edge /opt/aw-private-web/
install -m 0644 infra/private-web/*.service /etc/systemd/system/
systemctl daemon-reload
/opt/aw-private-web/manage init
/opt/aw-private-web/manage add invite-recette
```

Saisir le mot de passe dans l'invite masquée et le transmettre hors bande. SQLite et la clé dédiée restent sous /var/lib/aw-private-auth (0700). Un échec de migration, une collision de chemins ou une provenance indéterminée interrompt le staging. Préserver une sauvegarde chiffrée avant toute migration. Après restauration, purger toutes les sessions et réconcilier les retraits de comptes avant redémarrage.

### Répétition des unités installées

Garder les ports Internet fermés. Vérifier que 18080/18443 sont libres, puis lancer la répétition par `systemctl start aw-private-edge@loopback.service`. Le générateur borné de l’unité produit dans son RuntimeDirectory les mêmes règles avec écoute exclusive sur 127.0.0.1 et ::1, ports 18080 et 18443. Vérifier ces écoutes avec ss. Le contrôle de nom/Origin continue à utiliser autofind.tech au port HTTPS standard. Utiliser un tunnel local de test mappant ce port, ou `curl --connect-to autofind.tech:443:127.0.0.1:18443 https://autofind.tech/demo` (401), puis la même commande avec [::1]. Vérifier la chaîne TLS sans -k, le rapport après login, le refus de POST interorigine, l'expiration, la révocation, la déconnexion et le cache. Vérifier les trois propriétaires de processus, le confinement, le journal et le refus si l'autorité devient indisponible. Observer les sockets avec ss. Aucun changement aux autres unités.

Arrêter la répétition par `systemctl stop aw-private-edge@loopback.service`, retirer le compte de recette et créer les seuls comptes autorisés. Le parent conserve la preuve locale de la répétition et des gates avant l'ordre d'ouverture.

## Activation et arrêt

Après les gates, la commande root d'activation ponctuelle est :

```sh
systemctl start aw-private-edge@online.service
```

Systemd démarre les deux dépendances. Avant bind, nginx valide sa configuration et le certificat, puis le précontrôle exige un refus anonyme de l’autorité, l’annonce de la fixture et la présence du lien de déconnexion dans le rapport. Aucun secret dans la commande. Tester immédiatement depuis un réseau externe en IPv4 et IPv6, avec Safari/Chrome : TLS, redirection HTTP vers l'hôte fixe, formulaire sur URL avec fragment, absence de données avant login, annonce/rapport après, asset/API directs, refus après retrait et bouton Retour après logout. Tester le refus d'un autre Host et l'inaccessibilité des ports internes depuis l'extérieur. En cas d’échec, arrêter. Le démarrage automatique éventuel nécessite une décision d'exploitation distincte.

```sh
systemctl stop aw-private-edge@online.service aw-private-product.service aw-private-auth.service
```

Confirmer la libération des ports avec ss et le retrait externe IPv4/IPv6. Les volumes du prototype et l’aperçu 3129 restent intacts. Pour rétablir la version précédente, restaurer les binaires, configuration, build et unités consignés, avec migration compatible ; rejouer le staging. Ne pas restaurer de vieilles sessions ou réactiver un compte supprimé.

## Comptes et suivi

```sh
/opt/aw-private-web/manage add identifiant
/opt/aw-private-web/manage remove identifiant
/opt/aw-private-web/manage purge
```

Le retrait supprime le compte. Dès la requête suivante, son cookie en cours ne donne plus accès aux pages, API, rapports ou assets. Recréer le même identifiant ne réactive pas ses anciennes sessions. Une personne peut fermer sa session depuis le lien de pied de page ; la confirmation précise la perte des listes locales à cet appareil. La durée maximale est de quatre heures. La révocation bloque les lectures futures ; une copie déjà téléchargée peut rester en possession du destinataire.

Surveiller le journal des trois unités et les compteurs de statut/durée (`journalctl -t aw_private_edge`), 429/5xx, certificat et disponibilité du catalogue. Le journal d’accès exclut URL, paramètres, compte, IP et cookies. Purger périodiquement les sessions expirées avec manage purge ; borner la rétention des journaux et sauvegardes contenant les identifiants. Les essais réels sur appareil et la recette externe appartiennent au parent.
