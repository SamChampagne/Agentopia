# Agentopia 1.4 — bêta Windows

## 1.4.0-beta.18 — choisir son compte GitHub local

- Sélecteur dans Config, Connexions et `/compte github`, avec compte choisi visible et annulation sans changement.
- Réutilisation des comptes GitHub CLI locaux, contrôle de leur identité et préférence limitée à Agentopia.
- PR, tickets, CI, dépôts et Git HTTPS suivent le choix. Les clés SSH et l’identité des commits restent séparées.
- Invalidation des résultats de l’ancien compte, absence de repli silencieux et tests isolés du coffre personnel.
- [Guide des comptes GitHub](comptes-github.md).

## 1.4.0-beta.17 — choisir clairement l’agent d’une session

- `+ Session`, `/session`, `/nouvelle` et le premier message sans conversation ouverte affichent le choix de l’agent avant de créer la session. Le projet, les agents disponibles et leur connexion sont indiqués.
- La préférence de Config présélectionne l’agent en premier. Choisir un autre agent pour une session ne change pas cette préférence. Les commandes explicites `/codex`, `/claude` et `/perplexity` conservent leur lancement direct.
- L’en-tête du chat affiche **Agent : Codex**, **Claude**, **Perplexity** ou **Claude CLI**. L’identité apparaît avant les noms de projet longs, dans les deux interfaces. Les titres automatiques ne répètent plus le projet et le fournisseur.
- Échap annule sans créer de session ni envoyer de message ; une première saisie annulée retrouve son brouillon. Les scénarios de création et les petits écrans sont couverts par des tests isolés, sans appel aux fournisseurs.

## 1.4.0-beta.16 — écran noir au lancement

- Compatibilité du runtime JSX OpenTUI avec React en production, sans désactiver les optimisations du mode production. Le correctif de dépendance est versionné et réappliqué lors de la construction Windows.
- Le lanceur choisit explicitement le runtime JSX et le `tsconfig` d’Agentopia, indépendamment des paramètres du projet ouvert. Les contrôles repartent d’un cache de compilation vide.
- Sous Windows, Bun installé avec npm est résolu vers son binaire natif. Le démarrage n’essaie plus d’exécuter directement `bun.cmd` et n’utilise pas de shell pour le remplacer.
- Le précontrôle d’installation utilise le même mode production que le lancement réel. Il vérifie l’accueil, le cockpit, la saisie multiligne, l’affichage d’une erreur contrôlée et la reprise.
- La console de débogage vide ne s’ouvre plus par-dessus une erreur de rendu. Les essais du vrai point d’entrée désactivent la collecte et la maintenance lorsque le profil de test est utilisé.
- La suite ajoute un contrôle de démarrage en production et en développement, lancé depuis un dossier ayant un `tsconfig` différent. Les tests utilisent uniquement des profils temporaires.
- Le nettoyage des tests moteur ne surveille plus les anciens PID des enfants déjà terminés, que Windows peut réattribuer à d’autres processus.

La capture de l’écran noir a révélé une lacune dans les contrôles de la bêta 13 : les tests d’interface et d’installation validaient le mode développement, alors que le raccourci utilisait le mode production.

La bêta **1.4.0-beta.13** reprend les 12 priorités de stabilisation et les 8 améliorations de l’audit. [Guide et portée des changements](ameliorations-mn.md).

- **Conversations** : saisie multiligne, recherche dans l’historique, export Markdown/JSONL, choix du modèle et événements Claude progressifs.
- **Équipes** : file globale et plafonds par fournisseur, conservation des tentatives et coûts connus, reprise des conflits dans le même worktree, préparation explicite des dépendances, recettes comparaison et revue croisée.
- **Fiabilité et sécurité** : origine GitLab stricte, coffre atomique avec récupération, planifications corrompues bloquées, processus Git annulables, import transactionnel, sauvegarde du profil et diagnostics locaux sans contenu des conversations.
- **Vérifications** : JS/TS, Python, .NET et commandes explicites de `agentopia.json`, avec commande visible, confirmation, journal borné et preuve liée au projet.
- **Windows** : entretien des anciennes versions et désinstallation qui conserve les données. Signature d’éditeur prévue dans la construction/CI ; cette bêta reste non signée en l’absence de certificat configuré.

La bêta **1.4.0-beta.12** renforce la sécurité des sessions, des lancements Windows et de l’installation, tout en conservant les écrans actuels. [Audit détaillé, preuves et limites](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.12/docs/audit-securite-2026-10-30.md).

- **Sessions** : les identités incohérentes, réponses de permission invalides et fichiers redirigés sont refusés. Un réimport Codex ne vide plus un historique dont l’état est corrompu ou absent.
- **Windows** : fichiers, URL et chemins de terminal sont transmis comme arguments ; les lanceurs graphiques ne passent plus ces valeurs à cmd.exe. Les apostrophes typographiques sont traitées dans les chaînes PowerShell.
- **SFTP** : un serveur inconnu demande une confirmation explicite de son empreinte avant l’authentification. Une clé connue qui change reste bloquée. Les noms de fichiers distants dangereux sont refusés et un téléchargement ne remplace pas un fichier local existant.
- **Installation et mises à jour** : tailles bornées, extraction ZIP contrôlée, refus des jonctions et des collisions de chemins, vérification de la version réutilisée et des redirections de téléchargement.
- **Structure du code** : règles communes pour le stockage des sessions, les invocations Windows, les téléchargements et la connexion SFTP des deux interfaces.

La bêta **1.4.0-beta.11** ajoute un parcours de vérification dans **Équipes → Relire** : choisir un script réellement présent, lire la commande et le dossier, confirmer son exécution, puis consulter le résultat et son journal. Les preuves sont séparées des résumés des agents et deviennent périmées si le contenu du projet change. [Guide des vérifications et des améliorations de confort](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.11/docs/verifier-un-resultat.md).

- **Avis et erreurs** : `/avis`, **Alt+N** ou le bouton près de la saisie permettent de retrouver le texte complet des 100 derniers messages du lancement, y compris les causes des échecs.
- **Collage d’image** : **Alt+V** reste réactif pendant la capture. Le texte retapé et la conversation d’origine sont préservés ; un envoi attend la fin de l’ajout.
- **Préparation** : Config permet de revoir les projets ignorés et les agents reportés. Annuler `/choisir-agents` conserve les choix. `/scan` garde son filtre, affiche un bilan et ne prépare pas les fournisseurs.
- **Vérifications** : scripts JavaScript/TypeScript existants, journal et durée bornés, annulation, refus des agents encore actifs et protection contre un lancement concurrent. Une réussite de commande ne marque pas l’équipe intégrée et ne certifie pas la qualité fonctionnelle.

La bêta **1.4.0-beta.9** corrige les défauts reproduits pendant un audit multi-agent. [Rapport complet, critiques et prochaines priorités](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.11/docs/audit-stabilite-2026-10-30.md).

- **Équipes** : relancer une tâche préserve les autres échecs ; une exclusion incompatible avec les dépendances est expliquée et refusée ; la fin d’intégration est vérifiée dans Git au lieu de dépendre uniquement du résumé de l’agent.
- **Conversations** : cliquer sur les pièces jointes ou utiliser **Alt+I** pour les retirer ; un fichier inaccessible est signalé avant envoi ; le brouillon du maître est restauré après erreur.
- **Petit terminal** : sous 100 colonnes, le chat prend la largeur disponible avec accès aux sessions, actions et outils. Les préférences reviennent en agrandissant la fenêtre.
- **Données et projets** : sauvegarde et récupération des réglages ; choix explicite entre projets homonymes ; import contrôlé et planifications importées en pause.
- **Windows** : le lanceur lit une activation unique et atomique ; une erreur de changement de version conserve la version précédente. `/diagnostic` inclut les fournisseurs intégrés.

La bêta **1.4.0-beta.8** reprend la stabilisation des conversations préparée dans la bêta 7 : un double appui rapide sur Entrée ne déclenche plus deux envois ; parcourir l’historique avec ↑ ↓ conserve le brouillon, même lorsqu’une commande rappelée affiche des suggestions. La recherche utilise ses propres flèches et retrouve le message préparé à sa fermeture. Un historique remplacé ou temporairement inaccessible ne laisse plus une ancienne version figée ou un chat vide à l’écran.

Le contrôle Windows a bloqué la publication de la bêta 7 sur un refus de renommage pendant la réparation. La bêta 8 réessaie les renommages temporairement verrouillés pendant 12 secondes au maximum, avec une indication visible. Un refus permanent conserve la version active et donne une erreur lisible. Le nettoyage d’un dossier encore verrouillé ne masque plus le résultat ni ne laisse le verrou d’installation bloqué.

**Pg↑ / Pg↓** parcourent les échanges, **Alt+Début** rejoint leur début et **Alt+Fin** reprend le suivi des derniers messages. Lorsque la lecture est remontée, le lien **Derniers messages** propose le même retour au clic ; l’arrivée de texte ne déplace pas la lecture. Chaque changement de session ouvre sa propre conversation au dernier message. La disposition des écrans est conservée.

La bêta **1.4.0-beta.6** place la saisie de chaque session directement sous ses messages, dans la colonne du chat. Le champ reste visible pendant le défilement et suit la disposition des actions. Les brouillons, la recherche, les suggestions et le verrouillage pendant une reprise dans le terminal Codex sont conservés.

La bêta **1.4.0-beta.5** améliore les conversations : messages et sorties Codex progressifs, détails des outils (Alt+L), commandes lisibles, tableaux adaptés et séparation entre actions et chat. Les mini-graphes turquoise des cartes ont été retirés. **Ouvrir Codex** et **Codex à côté** reprennent la même conversation dans le terminal ; Agentopia garde le brouillon et reste en lecture seule jusqu’à la fermeture de Codex, puis relit l’historique. Le contrôle exclusif empêche deux tours concurrents.

Télécharger **Agentopia-Setup.exe**, puis l’ouvrir. La bêta 1.4.0-beta.4 ajoute une fenêtre de téléchargement (Mo et progression), de vérification et d’installation, puis ouvre Agentopia automatiquement. Annulation pendant le téléchargement, nouvelle tentative après erreur et journal local sont disponibles. Node et Bun sont téléchargés dans le paquet vérifié ; l’assistant guide le choix des projets et la connexion des fournisseurs. L’archive ZIP est disponible pour un lancement portable avec Agentopia.cmd.

- La limite d’un tour compte le travail actif. Une demande de permission ou une question utilisateur suspend le compteur ; Arrêter reste disponible.
- Les permissions expliquent l’action, montrent la commande exacte et proposent les détails techniques. Aucune nouvelle autorisation automatique.
- Dans une équipe, **Relire (b)** ouvre le résultat et les commandes observées, donne accès aux diffs, à l’intégration des branches retenues et au rangement. Une intégration interrompue reprend sa conversation existante.
- Les bilans distinguent temps de travail et attente utilisateur. Les écrans existants sont conservés.
- L’écriture de l’état tolère les refus temporaires de remplacement de fichier sous Windows, avec des tentatives bornées qui préservent le dernier état lisible.
- Les mises à jour suivent le canal installé : une bêta peut recevoir une nouvelle bêta ou une version stable supérieure ; une version stable reste sur les versions stables. Aucun retour automatique à une version plus ancienne.

Cette publication conserve les équipes guidées, les modèles réutilisables, le moteur détaché et la récupération après plantage des versions précédentes. Les conversations et les branches restent dans le profil utilisateur lors d’une mise à jour. `/reparer` et `/retour-version` sont disponibles pour les installations Setup.

La publication automatisée est conditionnée aux tests du moteur et de l’interface ainsi qu’au test du vrai Setup sur un runner GitHub Windows : démarrage sans Node/Bun dans le PATH, mise à jour, réparation, retour arrière et conservation des données. Les fournisseurs sont simulés dans ces tests ; un parcours Codex réel avec revue et reprise d’intégration a aussi été effectué sur la base 1.3.1. Claude et Perplexity nécessitent encore une validation avec leurs comptes réels. Le binaire n’est pas signé : cette validation ne constitue pas une certification SmartScreen/antivirus.

La nouvelle fenêtre ne supprime pas l’avertissement SmartScreen : le Setup est encore non signé. La signature avec une identité d’éditeur reconnue reste à mettre en place. Le nouveau bootstrap .NET remplace l’ancien exécutable Bun lancé depuis Téléchargements ; la recherche des mises à jour utilise maintenant le dépôt renommé `SamChampagne/Agentopia`.
