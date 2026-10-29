# Sessions intégrées et équipes mixtes

Après `npm run build`, relancer Agentopia (le lanceur habituel utilise les sources de l’interface et `dist/`).

## Utiliser les agents

- `+ Session` ou `/session` : choisir le projet et l’agent. **Config → Agents et sessions → Agent par défaut** (ou `/agent-defaut`) permet de choisir un fournisseur ou « Choisir à chaque fois ». Ce choix s’applique aussi au texte saisi sans conversation sélectionnée ; les conversations existantes gardent leur agent.
- `/claude projet`, `/codex projet`, `/perplexity projet` : ouvrir directement une conversation. Le message suivant se tape dans la barre du bas.
- `/fournisseurs` ou **Config → Fournisseurs IA** : connecter et vérifier les fournisseurs, enregistrer/retirer les clés API dans le coffre Windows existant. La création d’une session reprend après configuration. Le diagnostic lit le compte Codex ou le catalogue API Claude/Perplexity, sans génération. L’accès au modèle et le quota restent à confirmer au premier message. Une variable d’environnement est prioritaire sur la clé locale ; le dialogue le précise.
- `/historique-agents` : retrouver les conversations intégrées (y compris archivées) et les conversations locales Codex/Claude CLI des projets suivis. L’inventaire est aussi actualisé pendant la préparation du poste.
- Claude intégré utilise Claude Agent SDK avec `ANTHROPIC_API_KEY` ou la clé enregistrée. Il s’agit d’appels API facturés, distincts de l’abonnement Claude. `/onglet` et `/claude-cli` conservent l’accès au CLI Claude installé.
- Codex utilise le CLI installé, son app-server et son authentification existante (`codex login`). Le mode est `workspace-write`, avec les demandes d’autorisation présentées dans Agentopia.
- Perplexity utilise `PERPLEXITY_API_KEY` ou la clé enregistrée, via l’Agent API `/v1/agent`. Il fait de la recherche web avec sources ; il ne lit ni ne modifie les fichiers du projet.

Les agents de code peuvent demander une autorisation ou une précision : cliquer **Répondre à l’agent**. Le détail de l’action est affiché avant le choix. **Interrompre** arrête le tour et conserve la conversation. **Passer à un agent** ouvre une conversation chez un autre fournisseur avec la réponse précédente, ses sources et la consigne choisie.

## Agentopia et l’application Codex

Une conversation Codex créée ici utilise un vrai thread persistant du CLI local. Agentopia conserve son identifiant et reprend ce thread aux messages suivants. Il hérite de `CODEX_HOME` (par défaut `~/.codex`) ; l’application Codex Windows utilise aussi ce dossier par défaut. Cela permet un stockage local commun, sans assurer à lui seul le même affichage dans les deux interfaces.

**L’historique natif Codex est consulté via app-server**, dans le même `CODEX_HOME`, pour les projets suivis. Les conversations cloud, archivées côté Codex ou appartenant à un autre dossier de données ne sont pas incluses. Choisir une conversation importe ses messages en lecture seule. Au premier envoi, Agentopia crée un fork et poursuit cette copie : la conversation d’origine reste inchangée. Une reprise native Claude CLI utilise également une copie de session. Ce n’est pas une synchronisation en direct des deux conversations.

L’apparition automatique des threads créés ici dans l’application Codex n’a pas été validée : les interfaces peuvent filtrer leurs listes différemment.

Les agents distincts n’ont pas automatiquement accès aux conversations des autres. **Passer à un agent** et les dépendances d’une **équipe mixte** transmettent explicitement les résultats. Deux agents de code peuvent voir les mêmes fichiers lorsqu’ils travaillent dans le même dossier ; les équipes utilisent des worktrees distincts.

Le **maître** utilise le fournisseur choisi dans Config ou un choix automatique parmi les outils configurés. Il ne génère rien au démarrage. Il peut proposer un plan mixte de 1 à 8 tâches, validé avant création/lancement. Les revues/commits assistés, la planification native et les outils de coût Claude CLI restent spécifiques à Claude. Le compte Claude CLI et la clé API Claude intégré sont deux connexions distinctes.

Références : [stockage local sous Windows](https://learn.chatgpt.com/docs/app/windows#share-config-auth-and-sessions-with-wsl), [historique et filtres app-server](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters).

Les tours tournent dans des processus séparés de l’interface. L’historique et l’identifiant de conversation du fournisseur sont conservés pour les messages suivants. Les tâches trop longues sont interrompues après une heure ; une recherche Perplexity est limitée à trois minutes. Le budget et le coût des sessions intégrées ne sont pas encore agrégés dans le tableau des coûts Claude CLI.

## Équipes

`/equipe-mixte` propose deux formats :

1. Recherche Perplexity → développement Claude/Codex → revue Claude/Codex.
2. Un plan de 1 à 8 tâches avec fournisseur, mission et dépendances choisis. Les tâches indépendantes se lancent en parallèle, selon la limite d’agents de la configuration.

Le plan est enregistré avant tout appel. Ouvrir l’équipe, vérifier les missions, puis cliquer **Lancer**. Un dépôt Git avec un commit et un checkout propre est requis. Chaque tâche de code reçoit son propre worktree, basé sur les commits du dépôt. Les fichiers non suivis, variables d’environnement stockées dans des fichiers et modifications non commitées ne sont pas copiés.

Les résultats et sources des dépendances sont transmis au prochain agent ; leurs branches sont fusionnées dans son worktree avant son lancement. Un conflit Git bloque la tâche. Une tâche n’est marquée terminée qu’après un succès explicite du fournisseur, un résumé non vide et, pour le code, un worktree propre. Cela ne constitue pas une preuve que les tests métier sont suffisants : lire les résultats et les diffs avant intégration.

Garder au moins une fenêtre Agentopia ouverte pour que l’ordonnanceur lance les tâches suivantes. Les tours déjà démarrés continuent si l’interface ferme. **Intégrer** lance un agent dans le checkout principal après vérification qu’il est propre. Il fusionne les branches retenues et exécute les vérifications demandées. Aucun push automatique.

Archiver conserve les transcripts et les worktrees ; leur nettoyage automatique n’est pas implémenté. Les sessions, réservations et worktrees sont dans `~/.claudetopia-agents/`. La configuration et les clés restent dans les fichiers Agentopia habituels. `CLAUDETOPIA_DATA_DIR` permet un répertoire de données indépendant, notamment pour les tests.

## Interface

Les bordures et indicateurs lumineux du Live et des cartes latérales restent stables ; les données continuent à se mettre à jour. Dans Projets, les caractères filtrent la liste. La barre indique ce contexte, explique qu’elle est en pause et garde le brouillon. Échap efface le filtre, puis revient à la barre. Pendant un tour d’agent, on peut préparer le prochain message sans l’envoyer prématurément.

Chaque conversation conserve son brouillon et ses pièces jointes, y compris après fermeture normale. La recherche Ctrl+F possède sa propre saisie ; Échap retrouve le message. Si un envoi échoue, son texte revient dans la conversation d’origine, même si une autre est ouverte. Les brouillons sont sauvegardés localement dans `~/.claudetopia-brouillons/` ; les recherches restent en mémoire. Les fichiers joints sont référencés par leur chemin, pas copiés.

Une commande `/...` inconnue affiche des suggestions sans démarrer d’agent. Les chemins avec espaces s’écrivent entre guillemets, par exemple `/codex "C:\Mes projets\Application"`. Les actions des cartes et la palette ajoutent ces guillemets automatiquement.

## Vérifier et réparer l’installation

- `/version` : version du paquet, branche, révision des sources, dossier utilisé et date de la dernière maintenance réussie. Une vérification ancienne ne certifie pas les modifications ultérieures.
- `/maj` : vérifie l’absence de modifications locales, récupère les sources, installe les dépendances Node et Bun, compile puis contrôle les types de l’interface. Ces étapes ont lieu même si Git répond « déjà à jour ».
- `/reparer` : exécute les mêmes étapes locales sans `git pull`. Permet de reconstruire une version en développement sans remplacer ses changements.

Les étapes de compilation ci-dessus concernent les installations depuis les sources. Avec le paquet Windows, `/maj` recherche une Release compatible, `/reparer` réinstalle le paquet conservé hors ligne et `/retour-version` réactive la version précédente. L’interface et les sommes de contrôle sont vérifiées avant activation. Relancer le logiciel après maintenance. [Distribution Windows](distribution-windows.md).

`/preparer` reprend la préparation du poste : projets, sélection des fournisseurs, outils requis, connexion et inventaire des conversations. `/scan` effectue un nouveau scan et conserve les projets déjà suivis. **Config → Agents à utiliser** permet de modifier les fournisseurs sélectionnés, y compris ceux reportés. Les choix sont enregistrés entre les étapes ; aucune clé ne se trouve dans ce reçu.

## Vérifications

```powershell
npm run test:agents
npm run check:tui
bun tui/test-agents.tsx
npm run test:qol
npm run test:stabilite
node test-codex-protocole.mjs
```

Les tests d’agents utilisent des transports simulés et un dépôt Git temporaire. Ils couvrent états, permissions, interruptions, erreurs, verrouillage, protocoles, sources, dépendances et isolation des branches. Le dernier diagnostic parle au vrai app-server Codex sans créer de conversation ni appeler de modèle. Aucun de ces tests ne valide une exécution payante chez Claude ou Perplexity.

Références : [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Perplexity Agent API](https://docs.perplexity.ai/docs/agent-api/quickstart).

Diagnostics de connexion : [catalogue Claude](https://platform.claude.com/docs/en/api/models/list), [catalogue Perplexity dans son SDK officiel](https://github.com/perplexityai/perplexity-node/blob/main/api.md).
