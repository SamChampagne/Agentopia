# Agentopia

[Documentation](docs/README.md) · [État du dépôt](docs/etat-du-projet.md) · [Projet GitHub](https://github.com/users/SamChampagne/projects/4) · [Contribuer](CONTRIBUTING.md)

Poste de pilotage pour travailler avec Claude, Codex, Perplexity et des **équipes d’agents** : conversations, projets, Git, Docker et serveurs SSH.

Dans une session, le champ de message se trouve directement sous le chat et reste visible pendant le défilement. Chaque conversation conserve son brouillon.

**Bêta 18 — comptes GitHub locaux** : **Config → Compte GitHub** permet de passer d’un compte GitHub CLI à l’autre. Le choix s’applique aux PR, tickets, CI, dépôts et opérations GitHub HTTPS de l’application, sans changer le compte actif des autres outils. [Utilisation et périmètre SSH](docs/comptes-github.md).

**Bêta 17 — choix de l’agent** : `+ Session` affiche toujours Claude, Codex et Perplexity avant de créer la conversation. L’agent par défaut est proposé en premier ; tu peux en choisir un autre pour cette session. Le nom de l’agent reste visible en tête du chat et dans la liste des sessions.

**Bêta 16 — correctif de démarrage** : corrige l’écran noir et la console vide au lancement Windows. L’installation vérifie désormais le rendu en mode production, comme le raccourci, ainsi que l’accueil, la saisie et l’affichage des erreurs.

**Nouveau en bêta 13** : saisie multiligne, recherche dans les conversations et export, modèles par session/tâche, file globale des agents, comparaison et revue croisée, préparation des worktrees, vérifications Python/.NET et sauvegarde du profil. Les reprises, le coffre et les connexions Git sont renforcés. [Guide des 20 améliorations](docs/ameliorations-mn.md).

**Bêta 12** : sessions et historiques mieux protégés contre les fichiers corrompus, lancements Windows durcis et contrôle renforcé des mises à jour. Une première connexion SFTP demande de vérifier l’empreinte du serveur avant d’envoyer les identifiants. [Audit de sécurité et limites](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.18/docs/audit-securite-2026-10-30.md).

**Bêta 11** : dans **Équipes → Relire**, lance un script existant du projet et garde son résultat, son code de sortie et son journal. Les preuves deviennent périmées si le projet change. **Alt+N** retrouve les avis, **Alt+V** colle une image sans bloquer la saisie, et Config permet de revoir les choix reportés. [Guide pratique](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.18/docs/verifier-un-resultat.md).

**Audit et stabilisation 1.4.0-beta.9** : relances ciblées, intégration vérifiée dans Git, récupération des réglages et activation Windows cohérente. **Alt+I** gère les pièces jointes ; les petites fenêtres adaptent le chat sans changer tes préférences. [Audit complet et prochaines priorités](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.18/docs/audit-stabilite-2026-10-30.md).

**Stabilisation des conversations** : les frappes rapides ne doublent plus les envois, les flèches de l’historique préservent le brouillon et la recherche possède sa propre navigation. **Pg↑ / Pg↓** parcourent les messages ; **Alt+Fin** ou le lien **Derniers messages** retrouve le direct sans interrompre la lecture d’un ancien passage.

**[Télécharger Agentopia pour Windows](https://github.com/SamChampagne/Agentopia/releases/download/agentopia-1.4.0-beta.18/Agentopia-Setup.exe)** · [Notes de version et ZIP portable](https://github.com/SamChampagne/Agentopia/releases/tag/agentopia-1.4.0-beta.18)

Version : **1.4.0-beta.18 · Windows x64**. Les sources, le téléchargement et cette documentation correspondent à la même version ; le tag permet de retrouver exactement le code publié.

**Sessions intégrées Claude, Codex et Perplexity** : `+ Session` ou `/session`, configuration via `/fournisseurs`, collaboration via **Équipes → Nouvelle équipe**. [Connexion, utilisation et limites](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.18/docs/sessions-multi-agents.md).

**Conversations Codex** : réponses et sorties de commandes progressives, outils lisibles avec détails (Alt+L), tableaux adaptés à la largeur et séparation entre les actions et le chat. **Ouvrir Codex** et **Codex à côté** (Alt+J) reprennent la même conversation dans le terminal ; Agentopia conserve le brouillon et reste en lecture seule jusqu’à la fermeture de Codex. Les mini-graphes turquoise des cartes ont été retirés.

**Bêta 1.4** : attente utilisateur exclue de la limite de travail, permissions lisibles avec commande exacte, bilan **Relire (b) → Intégrer → Ranger**, et mises à jour adaptées au canal stable ou bêta. [Notes de version](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.18/docs/beta-1.4.md).

**Version 1.3.1** : récupération des verrous de session après plantage, protection contre deux workers exécutant le même tour et sauvegarde des équipes avant chaque écriture. Un fichier d’équipes illisible est signalé dans **Équipes → Récupérer les équipes** : la restauration conserve une copie du fichier abîmé et met le moteur en pause, sans relancer les tâches. Les conversations et branches restent en place.

**Version 1.3** : **Actions (a) → Modifier le plan** permet d’ajuster objectif, consignes, agents et dépendances avant le premier lancement. Une intégration interrompue peut reprendre dans sa conversation et sa branche, en conservant les fichiers et conflits en cours. Le moteur empêche deux équipes d’intégrer simultanément dans le même dossier. Les menus gèrent les frappes rapides et chaque dialogue retrouve ses propres valeurs. Les écrans existants sont conservés.

Les nouvelles équipes proposent un parcours guidé (développement + revue, correction + vérification, recherche + code + revue), les agents disponibles et un aperçu avant lancement. **Actions (a)** permet aussi d’enregistrer un modèle réutilisable, de consulter le bilan commun et de reprendre une tâche interrompue dans sa conversation et sa branche existantes.

Dans un projet, **Mission** guide aussi le travail avec un seul agent. Les équipes lancées et les tâches planifiées sont pilotées par un moteur indépendant de la fenêtre. **Config → Moteur des équipes** permet la pause globale ; **Utilisation des agents** et **Limites des agents** affichent les données disponibles et les limites réglables.

Lancer **Agentopia.bat** depuis les sources, ou le raccourci **Agentopia** après installation. L’ancien lanceur `Claudetopia.bat` reste compatible. Les fichiers `.claudetopia*`, les historiques et les clés existants sont conservés après le changement de nom. Le dépôt s’appelle désormais **SamChampagne/Agentopia**.

## Installation Windows

Télécharger **[Agentopia-Setup.exe depuis la bêta 1.4](https://github.com/SamChampagne/Agentopia/releases/tag/agentopia-1.4.0-beta.18)**. Le paquet contient Node 24, Bun et les dépendances de l’interface. Le petit installateur ouvre une fenêtre de téléchargement avec les Mo reçus et le pourcentage, puis affiche la vérification et l’installation. Agentopia s’ouvre automatiquement quand tout est prêt. Une connexion Internet est nécessaire ; aucun terminal de compilation n’est requis. En cas d’échec, la fenêtre propose de réessayer et d’ouvrir le journal.

**Windows affiche « éditeur inconnu » ?** La bêta n’est pas encore signée avec un certificat d’éditeur reconnu. La nouvelle fenêtre d’installation ne supprime pas l’avertissement SmartScreen, qui intervient avant le lancement. Une signature reconnue et la réputation de l’application sont des étapes distinctes de la distribution. [Explications Microsoft](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation).

Au premier lancement, choisis les projets et les agents à utiliser. Agentopia détecte les outils présents, propose les installations nécessaires et guide la connexion. Une interruption conserve les choix déjà faits. Le parcours reste accessible avec **Config → Préparer le poste** ; `/scan` recherche les projets sans préparer les agents.

`/maj`, `/reparer` et `/retour-version` gèrent les installations Windows : téléchargement vérifié, réparation avec le paquet conservé et retour à la version précédente. Les données personnelles sont séparées du logiciel. [Détails de construction et de validation](https://github.com/SamChampagne/Agentopia/blob/agentopia-1.4.0-beta.18/docs/distribution-windows.md).

## Installation depuis les sources

Dans PowerShell :

```powershell
git clone https://github.com/SamChampagne/Agentopia.git "$HOME\Agentopia"; & "$HOME\Agentopia\Installer.bat"
```

La branche principale contient Agentopia. Pour reconstruire exactement cette publication, utilise le tag `agentopia-1.4.0-beta.18`. **`/installation`** donne aussi le lien des téléchargements et une commande qui conserve la branche utilisée.

Sinon : copier ce dossier sur le poste et double-cliquer sur **Installer.bat**.

L'installateur vérifie les prérequis et dit clairement quoi installer s'il manque quelque chose,
installe les dépendances, compile, prépare Node 24 (pour la souris) et crée le raccourci **Agentopia** sur le bureau.
Pour mettre à jour plus tard : **`/maj`** dans Agentopia.

Le Setup inclut **Node 24 et Bun**. Pour développer depuis les sources, utilise également ces runtimes. Les outils suivants dépendent des fonctions choisies :

| Outil | Pour | Installation |
|---|---|---|
| Codex CLI | les sessions et équipes Codex | connexion guidée dans `/fournisseurs` |
| Claude Code | les sessions natives Claude CLI | `npm install -g @anthropic-ai/claude-code` |
| Git | statut des projets, commits, journal, équipes | `winget install Git.Git` |
| Windows Terminal | souris, onglets | `winget install Microsoft.WindowsTerminal` |
| VS Code | boutons « VS Code » | `winget install Microsoft.VisualStudioCode` |
| ripgrep | `/cherche` | `winget install BurntSushi.ripgrep.MSVC` |
| Docker Desktop | section Docker | optionnel |

## Tout connecter

**`/connexions`** (aussi dans Config et au clic droit) montre tout ce qui se connecte, avec son état et un clic pour le régler :
Claude Code et ton compte, Git, **GitHub / Azure DevOps / GitLab** (le jeton est vérifié auprès du site avant d'être gardé,
et peut être pris directement dans le presse-papiers), clé et serveurs SSH, SFTP, Docker, et les outils manquants
(installés avec winget). Au lancement, une ligne discrète signale s'il reste quelque chose à régler.

## Premier lancement

Agentopia scanne les projets, signale les doublons, puis prépare les fournisseurs choisis. Les clés API sont demandées dans une saisie masquée ; Codex propose la connexion dans le navigateur. Le diagnostic de connexion ne génère pas de réponse payante.
Ensuite :

- **`/diagnostic`** vérifie les outils et connexions et indique quoi corriger ;
- **`/preparer projets`**, **`/preparer agents`** : revoir les projets ignorés ou agents reportés ;
- **`/config`** (bouton « Config ») : fournisseurs, agent par défaut, maître, identité Git, connexions et apparence ;
- **`?`** affiche l'aide et les raccourcis.

## Équipes d'agents

Bouton **Équipes** en haut (ou `/equipe`, ou « Équipe d'agents » dans les actions d'un projet) :

1. tu choisis un projet, un objectif et un parcours : développement + revue, correction + vérification, recherche + code + revue, ou composition manuelle ;
2. tu vérifies les missions, les fournisseurs et les dépendances ; **Actions → Modifier le plan** permet de les ajuster avant le lancement ;
3. tu lances l’équipe : les tâches indépendantes avancent **en parallèle**, chaque agent de code dans son propre worktree Git ;
4. tu réponds aux permissions dans l’app, avec l’action expliquée et la commande exacte. L’attente de ta réponse ne consomme pas la limite de travail ;
5. **Relire (b)** rassemble résultats, commandes observées et diffs. Tu peux écarter une branche, puis choisir **Intégrer → Ranger**.

Toute l'équipe tient sur **une seule carte** dans la colonne de gauche. Les équipes de code nécessitent un dépôt Git avec un commit et un dossier sans changements non commités au lancement. Les résultats des dépendances sont transmis aux agents suivants.

**Reprendre** conserve la conversation, la branche et les fichiers existants. Le moteur continue après fermeture de la fenêtre tant que le PC reste allumé. Après un redémarrage du PC, ouvrir Agentopia redémarre le moteur. `/tout-arreter` met le travail en pause.

### Fournisseurs et comptes

| Fournisseur | Rôle | Connexion |
|---|---|---|
| **Codex** | Code, fichiers, commandes, revue | CLI Codex et connexion de ton compte |
| **Claude** | Code, fichiers, commandes, revue | Clé API Anthropic pour les sessions intégrées |
| **Perplexity** | Recherche web et réponses avec sources | Clé API Perplexity |

Les sessions Claude intégrées utilisent l’API Anthropic, distincte de l’abonnement Claude. L’accès au CLI Claude installé reste disponible. Perplexity ne modifie pas les fichiers du projet. La connexion se fait dans **Config → Fournisseurs IA** ou `/fournisseurs`.

## Le maître

Sous la liste des sessions, à gauche, **◇ MAÎTRE** utilise Codex, Claude, Perplexity ou Claude CLI selon **Config → Agent maître**. En automatique, il privilégie l’agent par défaut disponible.
Clique sa zone (ou **Alt+M**) puis écris en bas, par exemple :
« ferme les sessions finies », « où en est mon-projet ? », « lance une session sur mon-api pour écrire les tests »,
« dis à la session de dev de continuer ».

Il voit l'état à jour (sessions, équipes, projets) et répond par des commandes Agentopia, exécutées comme si tu les tapais.
Avant d'arrêter ou de supprimer une session, il demande **une** confirmation.
Il ne lance aucun modèle au démarrage : il attend une demande. Pour une mission collective, il propose un plan avec les agents et les dépendances ; tu peux le lancer, le garder sans démarrer ou l’annuler.
Réglages dans `~/.claudetopia.json` : `maitre.fournisseur`, `maitre.actif` ; `maitre.modele` concerne le transport Claude CLI.

## Serveurs SSH et fichiers (SFTP)

Vue **SSH** (bouton en haut) : se connecter, tester l'accès de Claude, **+ Ajouter**, **✎ Modifier**, **− Retirer** un serveur
(dans `~/.ssh/config`, le reste du fichier est gardé, sauvegarde `config.claudetopia.bak`), **⚿ Installer ma clé**
(une dernière fois le mot de passe, ensuite connexion sans mot de passe) et **⇅ Fichiers** pour parcourir le serveur.

`/sftp` ouvre aussi des connexions **SFTP** configurées dans Agentopia (`/sftp-ajouter`), par clé ou par **mot de passe**
(chiffré par Windows, seul ton compte peut le relire). Dans la vue Fichiers : ouvrir un fichier dans VS Code, télécharger,
envoyer, créer un dossier, supprimer. À la première connexion, compare l’empreinte affichée avec celle fournie par l’administrateur du serveur, puis choisis **Accepter la clé (o)**. **Échap** annule ; Entrée n’accepte pas la clé. Si une empreinte connue change, la connexion est refusée. Un téléchargement conserve tout fichier local déjà présent au même emplacement.

## Sessions

- **← Retour** ferme la vue d'une conversation ; **✕ Fermer la session** la ferme vraiment (arrière-plan : arrêtée et retirée,
  reprenable plus tard ; onglet : Claude s'arrête). Aussi au clic droit sur sa carte, ou en le demandant au maître.
- Les cartes suivent les fichiers de Claude Code en direct : une session fermée ou lancée apparaît ou disparaît aussitôt.

## Se repérer

- **Espaces** (onglets en haut de la colonne de gauche, ou Alt+S / P / R / D) : Sessions, Projets, SSH, Docker.
  Un seul à la fois : l'écran reste simple même avec beaucoup de choses.
- **Panneau de détail** : un clic sur un projet, un serveur ou un conteneur ouvre ses infos et ses actions à droite.
- **Espace** (dans la saisie vide) : la carte des actions, regroupées par thème (g = Git, s = Sessions, r = Serveurs…).
- **◉ Live** (`/global`) : la vue globale en direct, avec les sessions, les équipes, ce qui se passe dans chaque serveur SSH
  (charge, mémoire, disque, conteneurs ; serveurs accessibles par clé) et Docker.
- Ce qui est sous la souris s'éclaire ; la barre du bas montre les raccourcis du moment.
- Dans **Projets**, taper filtre la liste. La barre du bas explique qu’elle est en pause et conserve ton brouillon. **Échap** efface le filtre, puis revient à la barre de message.
- Dans **Live**, les bordures restent stables pendant que les données se mettent à jour.

## Confort et outils

| | |
|---|---|
| **Ctrl+K** | palette : tout chercher et lancer (« proj com » → Commit · mon-projet) |
| **Ctrl+F** | chercher dans la conversation ; Entrée / ↑ ↓ parcourent les résultats, Échap retrouve le brouillon |
| **Pg↑ / Pg↓** | parcourir les messages sans modifier la saisie |
| **Alt+Début / Alt+Fin** | début de la conversation / derniers messages et reprise du suivi en direct |
| **`/questions`** | ce que les sessions attendent de toi, avec la réponse proposée (clic sur « en attente ») |
| **⎘ Copier** | le dernier bloc de code ou la dernière réponse de l’agent |
| **glisser un fichier** | dans la fenêtre : pièce jointe du message |
| **Alt+N** ou **`/avis`** | retrouver les 100 derniers avis de ce lancement, lire leur détail et copier |
| **Alt+V** | ajouter une image sans bloquer la saisie ; elle rejoint le brouillon d’origine |
| **Alt+I** ou clic sur les pièces jointes | retirer une pièce ou toutes ; le texte reste dans le brouillon |
| **Alt+A** | actions de la session, aussi accessibles dans le menu du chat compact |
| **`/cout`, `/budget`** | coût du jour en équivalent API (barre du bas), alerte au-delà d'un budget |
| **`/planifier`** | un agent chaque jour à heure fixe, via le moteur en arrière-plan |
| **`/mission`** | corriger, développer ou analyser avec l’agent de code choisi |
| **`/tout-arreter`, `/moteur`** | pause globale persistante ; état et reprise du moteur |
| **`/utilisation`, `/limites-agents`** | tours, jetons et coûts renseignés ; limites de tours et de durée |
| **`/pr-corriger`, `/ci-reparer`** | GitHub : corriger les commentaires d'une PR, réparer un pipeline en échec |
| **`/surveiller-logs`** | notification à chaque erreur dans les logs d'un conteneur ; analyse par Claude |
| **`/exporter`, `/importer`** | emporter ses réglages sans clés privées ni jetons ; les tâches importées restent en pause |
| **`/cartes detaillees`** | cartes de session sur 3 lignes |
| **`/apparence`** | profil Windows Terminal « Agentopia » : Catppuccin, Tokyo Night, Dracula, Nord ou Gruvbox, police Cascadia Code, transparence acrylique, effet rétro (`/apparence retirer` l'enlève) |
| **`/theme`** | couleurs de l'interface, dont les mêmes palettes |
| **`/notifications-cliquables`** | un clic sur une notification ouvre la session (lien enregistré pour ton compte) |

Au lancement, Agentopia rouvre la conversation ou la vue où tu en étais.
Les équipes ont des modèles prêts (audit sécurité, dépendances, tests, mise en prod…) et, avant de fusionner,
chaque tâche se relit (≠ Voir le diff) et peut être écartée.

## Fichiers sur le poste

| Fichier | Contenu |
|---|---|
| `~/.claudetopia.json` | configuration (projets, thème, prompts favoris, équipes…) |
| `~/.claudetopia.json.sauvegarde.json` | dernière configuration sauvegardée ; récupération signalée dans Config et `/diagnostic` |
| `~/.claudetopia-equipes.json` | équipes d'agents en cours |
| `~/.claudetopia-verifications/` | résultats et journaux des scripts lancés depuis Relire |
| `~/.claudetopia-jetons.json` | jetons d'accès, chiffrés pour le compte Windows (DPAPI) |
| `~/.claudetopia-node24` | chemin du Node 24 utilisé pour la souris |
| `~/.claudetopia-historique` | historique des commandes |

Les anciens fichiers `~/.cli-perso*` sont repris automatiquement au premier lancement.

## Validation de la bêta

La validation comprend **203 tests Node**, **11 scénarios d’interface** et les contrôles du vrai Setup sur un Windows GitHub distinct du poste de développement : installation, mise à jour, réparation, retour arrière et conservation des données. La publication automatique dépend de leur réussite. Les téléchargements sont vérifiés par SHA-256.

Les fournisseurs sont simulés en CI. Un parcours Codex réel avec développement, revue et reprise d’intégration a aussi été testé sur la base 1.3.1 ; les parcours Claude et Perplexity restent à valider avec leurs comptes réels.

[Résultats de la validation Windows](https://github.com/SamChampagne/Agentopia/actions/workflows/validation.yml)

## Développement

```
npm run build          # compile src/ vers dist/
npm run test:ci        # types, moteur et parcours d’interface, fournisseurs simulés
npm run package:windows # construit le Setup et le ZIP sur Windows x64
npm test               # interface (clics et clavier simulés) + synchro git
npm run test:equipe    # moteur d'équipe sur un dépôt jetable (plan réel par Claude)
npm run test:fluidite  # rafraîchissements et réactivité au repos
npm run test:vitesse   # délai clic / touche / molette en plein écran
npm run test:ssh       # config SSH et SFTP (serveur local jetable)
node mesure-memoire.mjs · node compter-processus.mjs   # mémoire, programmes lancés en fond
```
