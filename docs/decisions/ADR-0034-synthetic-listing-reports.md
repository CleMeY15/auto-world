# ADR-0034 — Références de rapports dans la démo synthétique

Proposé pour TASK-0129 sur PR260. Le détail affiche les pièces explicitement fournies avec une publication. La présence d’un nom de fournisseur, d’un VIN ou d’une offre commerciale ne démontre aucune disponibilité. [ADR-0025](ADR-0025-official-history-guide.md) régit le guide public de recours.

## Contrat V1

La référence nomme la publication, le fournisseur, la provenance déclarée et un identifiant de document local. Le catalogue des documents synthétiques lie indépendamment chaque document à une publication et à un fournisseur. La liste et le lecteur exigent une correspondance exacte ; la destination est une route interne issue du document admis. Le lecteur exige aussi que le document ait été fourni pour cette annonce. Les documents sont propres à la démo normale et à sa version de corpus. La clé du document est publique et fictive. Un autre pays ou fournisseur peut étendre le catalogue et fournir ses propres pièces sans changer le parcours de lecture.

Aucune évolution des protocoles réseau ou des contrats interservices. Une future source autorisée pourra fournir des références via un adaptateur de confiance ; admettre des documents réels ou des liens confidentiels nécessiterait une politique d’accès et de destination par fournisseur. Les URLs, jetons et données d’identité réels sont hors contrat V1. Aucun appel tiers, préchargement de rapport tiers, événement d’analytics ou journal de référence de rapport. Une navigation locale peut apparaître dans les journaux HTTP avec des identifiants exclusivement synthétiques.

## Modalités vérifiées le 18 novembre 2026

- Le titulaire génère et partage le lien du rapport. Le guide reste disponible quand aucun document n’est fourni. [HistoVec, FAQ d’utilisation](https://histovec.interieur.gouv.fr/histovec/faq-comment-utiliser-histovec)
- Un détenteur peut télécharger et partager un PDF carVertical. L’existence d’une offre d’achat ne fournit aucune pièce à une annonce. [carVertical France, formats disponibles](https://www.carvertical.com/fr/help/a-propos-du-service/en-quels-formats-les-rapports-sont-disponibles)
- CARFAX Europe distingue aperçu commercial et rapport consultable après acquisition. Les exemples n’impliquent aucun achat ni droit de redistribution d’un original. [CARFAX Europe, accès au rapport](https://support.carfax.eu/s/article/How-can-I-buy-a-CARFAX-Vehicle-History-Report?language=en_US)

Les pièces consultables ici sont des notes originales Auto World entièrement fictives. Les noms de fournisseurs illustrent les provenances déclarées, sans reproduire leur mise en page ni leur attribuer la création des exemples.
