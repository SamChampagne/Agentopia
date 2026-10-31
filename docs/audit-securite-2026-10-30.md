# Agentopia — audit de sécurité du 30 octobre 2026

Lot livré dans la bêta **1.4.0-beta.12**. La revue porte sur les fichiers de session et les permissions, les ouvertures de programmes Windows, le SFTP et la chaîne d’installation/mise à jour. Elle combine inspection du code, reproductions dans des profils temporaires et tests de non-régression. Elle ne constitue pas une certification de sécurité de l’ensemble du logiciel.

## Défauts reproduits et corrections

| Surface | Risque constaté | Comportement corrigé |
| --- | --- | --- |
| Identité d’une session | L’identité chargée depuis `etat.json` pouvait désigner une autre session lors de la récupération. | Le schéma est validé et l’identité doit correspondre au dossier avant toute écriture. |
| Permission | Un identifiant malformé pouvait construire un chemin de réponse hors du dossier prévu. | Identifiants validés, réponse liée à la session, au tour et à la demande ; contrôle sous verrou. |
| Fichiers redirigés | Une jonction de dossier de session pouvait rediriger une écriture vers un autre emplacement. | Jonctions, liens symboliques et liens durs sont refusés sur les fichiers de session utilisés. Une entrée invalide ne masque pas les sessions valides. |
| Réimport Codex | Un état corrompu était confondu avec une absence ; le transcript existant pouvait être vidé. | Lecture stricte pour les mutations, conservation des données et création exclusive du transcript. |
| Programmes Windows | Des chemins ou URL étaient incorporés dans une ligne interprétée par `cmd.exe`. | Invocations natives avec tableau d’arguments ; résolution de `code.cmd` vers `Code.exe` et nettoyage des variables Electron correspondantes. |
| PowerShell | Les apostrophes typographiques n’étaient pas traitées comme des délimiteurs par les anciens helpers. | Encodage sûr des valeurs ; tests du parseur PowerShell et aller-retour des arguments. Les commandes injectées des fixtures ne sont jamais exécutées. |
| Première connexion SFTP | La clé d’un serveur inconnu était enregistrée automatiquement. | Confirmation explicite de l’empreinte avant authentification. Entrée ne vaut pas acceptation ; Échap annule. Une clé connue modifiée est toujours refusée. |
| Copie SFTP | Les noms fournis par le serveur et les destinations locales demandaient un contrôle renforcé. | Refus des noms dangereux pour Windows, copie temporaire isolée, ouverture exclusive et suppression du seul fichier partiel créé en cas d’échec. |

Les tests SFTP utilisent un vrai serveur SSH local éphémère et vérifient qu’aucune tentative d’authentification n’arrive avant le consentement. Ils n’utilisent aucun secret enregistré. Les empreintes déjà enregistrées restent conservées ; le correctif n’atteste pas rétrospectivement leur origine.

## Installation et mises à jour

Le contrôle du paquet vérifie désormais les composants physiques des chemins, les doublons après normalisation Windows, les noms réservés, les fichiers non réguliers et les empreintes. Une version déjà présente doit correspondre au manifeste du paquet vérifié. Les liens durs et jonctions sont couverts par des fixtures Windows.

Les extractions ZIP sont bornées avant puis pendant la copie : 50 000 entrées, 512 Mio par fichier et 2 Gio au total. Le manifeste est limité à 8 Mio. Le bootstrap natif contrôle aussi les quelques fichiers qu’il extrait avant de démarrer le worker. Les tests d’archives sont des fichiers miniatures inertes : ils vérifient les refus sans installer de programme hostile. La tentative de traversée par un segment `.. ` n’a pas été reproduite avec .NET ; les contrôles supplémentaires correspondants sont de la défense en profondeur.

Les mises à jour de l’application vérifient chaque redirection HTTPS avant de la suivre, limitent les domaines aux points de distribution GitHub attendus, bornent les réponses JSON et l’archive à 1 Gio, et calculent les empreintes en flux. L’import de projets est limité à 4 Mio avant analyse.

## Structure et validation

- `stockageSessions.ts` centralise l’identité, le schéma et les chemins des sessions ; les mutations distinguent absence et corruption.
- `lancementsWindows.ts` construit les invocations, séparément de leur exécution.
- `telechargementDistribution.ts` centralise les budgets, redirections et contrôles de téléchargement.
- `confianceSftp.ts` gère les empreintes et noms de fichiers ; la connexion est partagée entre Ink et OpenTUI avec injection des hooks de leur version de React respective.
- Les suites `test-securite-sessions.mjs`, `test-securite-lanceurs.mjs`, `test-securite-sftp.mjs` et `test-securite-distribution.mjs` font partie de `npm run test:ci`. Le parcours SFTP est aussi testé dans OpenTUI à 60 et 100 colonnes.

**Validation locale finale** : `npm run test:ci` passe avec **203 tests Node, aucun échec ni test ignoré**, et **11 scénarios OpenTUI**. Le lot ajoute 39 tests de sécurité et un contrôle de taille d’import, ainsi qu’un scénario SFTP. La publication est conditionnée au même contrôle sur Windows GitHub, puis aux tests du vrai Setup et du téléchargement.

Les audits npm des dépendances de production et Bun de l’interface n’ont signalé aucun avis connu au moment du contrôle. Cela ne démontre pas l’absence de défauts dans ces dépendances ou dans le code du projet.

## Limites et suite

1. La signature du Setup reste à mettre en place. SHA-256 détecte un téléchargement différent du manifeste de référence ; ce n’est pas une signature d’éditeur ni une protection contre la compromission simultanée du compte de publication et de ses fichiers.
2. Ces contrôles ne forment pas une sandbox contre un processus malveillant possédant déjà les mêmes droits Windows et capable de remplacer des chemins pendant leur utilisation. Les projets exécutés par les agents et les scripts validés par l’utilisateur conservent leurs permissions système.
3. La revue n’est pas exhaustive : poursuivre la réduction des anciennes commandes shell, la revue des journaux et des données sensibles, ainsi que les essais de rupture réseau et de disque indisponible. Une interface de récupération des sessions corrompues et la reprise d’un verrou d’import abandonné après plantage restent à développer ; les fichiers concernés sont conservés, mais une session invalide est actuellement absente des listes.
4. Les scénarios des fournisseurs sont simulés dans la CI. Cette bêta ne prétend pas avoir requalifié Claude et Perplexity avec des comptes réels.
5. Les écrans existants sont conservés. La confirmation SFTP est le changement visible principal ; les autres protections se manifestent par des refus expliqués et la conservation des fichiers lorsqu’une opération n’est pas sûre.
