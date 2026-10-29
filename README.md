# Agentopia

Poste de pilotage pour travailler avec Claude, Codex, Perplexity et des **équipes d’agents** : conversations, projets, Git, Docker et serveurs SSH.

**Sessions intégrées Claude, Codex et Perplexity** : `+ Session` ou `/session`, configuration via `/fournisseurs`, collaboration via **Équipes → Nouvelle équipe**. [Connexion, utilisation et limites](docs/sessions-multi-agents.md).

**Version 1.3** : **Actions (a) → Modifier le plan** permet d’ajuster objectif, consignes, agents et dépendances avant le premier lancement. Une intégration interrompue peut reprendre dans sa conversation et sa branche, en conservant les fichiers et conflits en cours. Le moteur empêche deux équipes d’intégrer simultanément dans le même dossier. Les menus gèrent les frappes rapides et chaque dialogue retrouve ses propres valeurs. Les écrans existants sont conservés.

Les nouvelles équipes proposent un parcours guidé (développement + revue, correction + vérification, recherche + code + revue), les agents disponibles et un aperçu avant lancement. **Actions (a)** permet aussi d’enregistrer un modèle réutilisable, de consulter le bilan commun et de reprendre une tâche interrompue dans sa conversation et sa branche existantes.

Dans un projet, **Mission** guide aussi le travail avec un seul agent. Les équipes lancées et les tâches planifiées sont pilotées par un moteur indépendant de la fenêtre. **Config → Moteur des équipes** permet la pause globale ; **Utilisation des agents** et **Limites des agents** affichent les données disponibles et les limites réglables.

Lancer **Agentopia.bat** (ou le raccourci **Agentopia**). L’ancien lanceur `Claudetopia.bat` reste compatible. Les fichiers `.claudetopia*`, les historiques et les clés existants sont conservés ; seule l’ancienne bannière par défaut devient **AGENTOPIA**. Le dépôt GitHub garde pour l’instant son adresse `SamChampagne/ClaudeTopia`.

## Installation Windows

Le paquet **Agentopia-Setup.exe** contient Node 24, Bun et les dépendances de l’interface. Un double-clic installe dans le profil utilisateur, vérifie l’interface et ouvre la préparation guidée. Aucun terminal de compilation n’est nécessaire. **Ce paquet est pour l’instant construit localement ; il n’est pas encore publié dans les Releases GitHub.**

Au premier lancement, choisis les projets et les agents à utiliser. Agentopia détecte les outils présents, propose les installations nécessaires et guide la connexion. Une interruption conserve les choix déjà faits. Le même parcours reste accessible avec **Config → Préparer le poste** ou `/scan`.

`/maj`, `/reparer` et `/retour-version` gèrent les installations Windows : téléchargement vérifié, réparation avec le paquet conservé et retour à la version précédente. Les données personnelles sont séparées du logiciel. [Détails de construction et de validation](docs/distribution-windows.md).

## Installation depuis les sources

Dans PowerShell :

```powershell
git clone https://github.com/SamChampagne/ClaudeTopia.git "$HOME\Agentopia"; & "$HOME\Agentopia\Installer.bat"
```

Dans Agentopia, **`/installation`** affiche cette ligne avec la bonne adresse, prête à copier.

Si le dépôt est public, aussi :

```powershell
irm https://raw.githubusercontent.com/SamChampagne/ClaudeTopia/main/install.ps1 | iex
```

Sinon : copier ce dossier sur le poste et double-cliquer sur **Installer.bat**.

L'installateur vérifie les prérequis et dit clairement quoi installer s'il manque quelque chose,
installe les dépendances, compile, prépare Node 24 (pour la souris) et crée le raccourci **Agentopia** sur le bureau.
Pour mettre à jour plus tard : **`/maj`** dans Agentopia.

Seul **Node.js 18+** est obligatoire (`winget install OpenJS.NodeJS.LTS`). Le reste est conseillé :

| Outil | Pour | Installation |
|---|---|---|
| Claude Code | les sessions et équipes Claude | `npm install -g @anthropic-ai/claude-code` |
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

- **`/diagnostic`** vérifie que tout fonctionne et dit quoi corriger ;
- **`/config`** (bouton « Config ») : fournisseurs, agent par défaut, maître, identité Git, connexions et apparence ;
- **`?`** affiche l'aide et les raccourcis.

## Équipes d'agents

Bouton **Équipes** en haut (ou `/equipe`, ou « Équipe d'agents » dans les actions d'un projet) :

1. tu choisis un projet et tu écris l'objectif ;
2. un **chef d'équipe** lit le code et découpe l'objectif en tâches, chacune avec un rôle métier
   (architecte, backend, frontend, données, tests, sécurité, doc, DevOps) ;
3. tu valides le plan (▶ Lancer) : les agents travaillent **en parallèle**, chacun dans son propre worktree git ;
   une tâche qui dépend d'une autre attend, puis récupère sa branche ;
4. quand tout est fait, **⇄ Intégrer** : un intégrateur fusionne les branches, résout les conflits et lance les tests.

Toute l'équipe tient sur **une seule carte** dans la colonne de gauche (progression, permissions en attente).
Réglages dans `~/.claudetopia.json` : `equipe.parallele` (agents en même temps, 3 par défaut)
et `equipe.permissions` (`acceptEdits` par défaut : les agents modifient les fichiers sans demander,
mais demandent avant les commandes).

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
envoyer, créer un dossier, supprimer. L'empreinte d'un serveur est enregistrée à la 1re connexion : si elle change, la connexion est refusée.

## Sessions

- **← Retour** ferme la vue d'une conversation ; **✕ Fermer la session** la ferme vraiment (arrière-plan : arrêtée et retirée,
  reprenable plus tard ; onglet : Claude s'arrête). Aussi au clic droit sur sa carte, ou en le demandant au maître.
- Les cartes suivent les fichiers de Claude Code en direct : une session fermée ou lancée apparaît ou disparaît aussitôt.

## Poste modeste (8 Go)

Agentopia occupe ~110 Mo et ~3 % d'un cœur au repos. Le maître (~250 Mo) s'endort après 30 min sans demande
(5 min sous 12 Go de RAM, où il ne démarre d'ailleurs qu'au premier besoin) ; réglable avec `maitre.veille` (minutes, 0 = jamais).
Si Claude Code n'est pas installé ou pas connecté, la zone du maître le dit : un clic l'installe ou ouvre la connexion.

## Se repérer

- **Espaces** (onglets en haut de la colonne de gauche, ou Alt+S / P / R / D) : Sessions, Projets, SSH, Docker.
  Un seul à la fois : l'écran reste simple même avec beaucoup de choses.
- **Panneau de détail** : un clic sur un projet, un serveur ou un conteneur ouvre ses infos et ses actions à droite.
- **Espace** (dans la saisie vide) : la carte des actions, regroupées par thème (g = Git, s = Sessions, r = Serveurs…).
- **◉ Live** (`/global`) : la vue globale en direct, avec les sessions, les équipes, ce qui se passe dans chaque serveur SSH
  (charge, mémoire, disque, conteneurs ; serveurs accessibles par clé) et Docker.
- Ce qui est sous la souris s'éclaire ; la barre du bas montre les raccourcis du moment.

## Confort et outils

| | |
|---|---|
| **Ctrl+K** | palette : tout chercher et lancer (« proj com » → Commit · mon-projet) |
| **Ctrl+F** | chercher dans la conversation ouverte |
| **`/questions`** | ce que les sessions attendent de toi, avec la réponse proposée (clic sur « en attente ») |
| **⎘ Copier** | le dernier bloc de code de Claude (bouton de la conversation, clic droit) |
| **glisser un fichier** | dans la fenêtre : pièce jointe du message |
| **`/cout`, `/budget`** | coût du jour en équivalent API (barre du bas), alerte au-delà d'un budget |
| **`/planifier`** | un agent chaque jour à heure fixe, via le moteur en arrière-plan |
| **`/mission`** | corriger, développer ou analyser avec l’agent de code choisi |
| **`/tout-arreter`, `/moteur`** | pause globale persistante ; état et reprise du moteur |
| **`/utilisation`, `/limites-agents`** | tours, jetons et coûts renseignés ; limites de tours et de durée |
| **`/pr-corriger`, `/ci-reparer`** | GitHub : corriger les commentaires d'une PR, réparer un pipeline en échec |
| **`/surveiller-logs`** | notification à chaque erreur dans les logs d'un conteneur ; analyse par Claude |
| **`/exporter`, `/importer`** | emporter sa configuration sur un autre poste (sans aucun secret) |
| **`/mode clair`, `/cartes detaillees`** | terminal à fond blanc, cartes sur 3 lignes |
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
| `~/.claudetopia-equipes.json` | équipes d'agents en cours |
| `~/.claudetopia-jetons.json` | jetons d'accès, chiffrés pour le compte Windows (DPAPI) |
| `~/.claudetopia-node24` | chemin du Node 24 utilisé pour la souris |
| `~/.claudetopia-historique` | historique des commandes |

Les anciens fichiers `~/.cli-perso*` sont repris automatiquement au premier lancement.

## Développement

```
npm run build          # compile src/ vers dist/
npm test               # interface (clics et clavier simulés) + synchro git
npm run test:equipe    # moteur d'équipe sur un dépôt jetable (plan réel par Claude)
npm run test:fluidite  # rafraîchissements et réactivité au repos
npm run test:vitesse   # délai clic / touche / molette en plein écran
npm run test:ssh       # config SSH et SFTP (serveur local jetable)
node mesure-memoire.mjs · node compter-processus.mjs   # mémoire, programmes lancés en fond
```
