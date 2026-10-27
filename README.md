# Claudetopia

Poste de pilotage pour travailler avec Claude Code : sessions Claude en direct, **équipes d'agents** sur un projet, projets, Git, Docker, serveurs SSH.

## Installation en une ligne (n'importe quel poste Windows)

Dans PowerShell :

```powershell
git clone https://github.com/SamChampagne/ClaudeTopia.git "$HOME\Claudetopia"; & "$HOME\Claudetopia\Installer.bat"
```

Dans Claudetopia, **`/installation`** affiche cette ligne avec la bonne adresse, prête à copier.

Si le dépôt est public, aussi :

```powershell
irm https://raw.githubusercontent.com/SamChampagne/ClaudeTopia/main/install.ps1 | iex
```

Sinon : copier ce dossier sur le poste et double-cliquer sur **Installer.bat**.

L'installateur vérifie les prérequis et dit clairement quoi installer s'il manque quelque chose,
installe les dépendances, compile, prépare Node 24 (pour la souris) et crée le raccourci **Claudetopia** sur le bureau.
Pour mettre à jour plus tard : **`/maj`** dans Claudetopia.

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

Claudetopia scanne le poste (projets, doublons, serveurs SSH, outils) et propose les projets à suivre.
Ensuite :

- **`/diagnostic`** vérifie que tout fonctionne et dit quoi corriger ;
- **`/config`** (bouton « Config ») : compte Claude, identité Git, jetons GitHub / Azure DevOps / GitLab, thème, nom affiché ;
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

Sous la liste des sessions, à gauche, **◇ MAÎTRE** est un Claude toujours ouvert qui gère tes sessions à ta place.
Clique sa zone (ou **Alt+M**) puis écris en bas, par exemple :
« ferme les sessions finies », « où en est mon-projet ? », « lance une session sur mon-api pour écrire les tests »,
« dis à la session de dev de continuer ».

Il voit l'état à jour (sessions, équipes, projets) et répond par des commandes Claudetopia, exécutées comme si tu les tapais.
Avant d'arrêter ou de supprimer une session, il demande **une** confirmation.
Il démarre en arrière-plan au lancement : il répond ensuite en 2 à 4 secondes.
Réglages dans `~/.claudetopia.json` : `maitre.modele` (`haiku` par défaut, rapide), `maitre.actif`.

## Serveurs SSH et fichiers (SFTP)

Vue **SSH** (bouton en haut) : se connecter, tester l'accès de Claude, **+ Ajouter**, **✎ Modifier**, **− Retirer** un serveur
(dans `~/.ssh/config`, le reste du fichier est gardé, sauvegarde `config.claudetopia.bak`), **⚿ Installer ma clé**
(une dernière fois le mot de passe, ensuite connexion sans mot de passe) et **⇅ Fichiers** pour parcourir le serveur.

`/sftp` ouvre aussi des connexions **SFTP** configurées dans Claudetopia (`/sftp-ajouter`), par clé ou par **mot de passe**
(chiffré par Windows, seul ton compte peut le relire). Dans la vue Fichiers : ouvrir un fichier dans VS Code, télécharger,
envoyer, créer un dossier, supprimer. L'empreinte d'un serveur est enregistrée à la 1re connexion : si elle change, la connexion est refusée.

## Sessions

- **← Retour** ferme la vue d'une conversation ; **✕ Fermer la session** la ferme vraiment (arrière-plan : arrêtée et retirée,
  reprenable plus tard ; onglet : Claude s'arrête). Aussi au clic droit sur sa carte, ou en le demandant au maître.
- Les cartes suivent les fichiers de Claude Code en direct : une session fermée ou lancée apparaît ou disparaît aussitôt.

## Poste modeste (8 Go)

Claudetopia occupe ~110 Mo et ~3 % d'un cœur au repos. Le maître (~250 Mo) s'endort après 30 min sans demande
(5 min sous 12 Go de RAM, où il ne démarre d'ailleurs qu'au premier besoin) ; réglable avec `maitre.veille` (minutes, 0 = jamais).
Si Claude Code n'est pas installé ou pas connecté, la zone du maître le dit : un clic l'installe ou ouvre la connexion.

## Confort et outils

| | |
|---|---|
| **Ctrl+K** | palette : tout chercher et lancer (« proj com » → Commit · mon-projet) |
| **Ctrl+F** | chercher dans la conversation ouverte |
| **`/questions`** | ce que les sessions attendent de toi, avec la réponse proposée (clic sur « en attente ») |
| **⎘ Copier** | le dernier bloc de code de Claude (bouton de la conversation, clic droit) |
| **glisser un fichier** | dans la fenêtre : pièce jointe du message |
| **`/cout`, `/budget`** | coût du jour en équivalent API (barre du bas), alerte au-delà d'un budget |
| **`/planifier`** | une session chaque jour à heure fixe (tant que Claudetopia est ouvert) |
| **`/pr-corriger`, `/ci-reparer`** | GitHub : corriger les commentaires d'une PR, réparer un pipeline en échec |
| **`/surveiller-logs`** | notification à chaque erreur dans les logs d'un conteneur ; analyse par Claude |
| **`/exporter`, `/importer`** | emporter sa configuration sur un autre poste (sans aucun secret) |
| **`/mode clair`, `/cartes detaillees`** | terminal à fond blanc, cartes sur 3 lignes |
| **`/notifications-cliquables`** | un clic sur une notification ouvre la session (lien enregistré pour ton compte) |

Au lancement, Claudetopia rouvre la conversation ou la vue où tu en étais.
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
