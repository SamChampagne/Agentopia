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

Les conversations Codex proposent **Ouvrir Codex** et **Codex à côté** (Alt+J) dès que le tour en cours est terminé. Après un premier message dans Agentopia, ces actions reprennent **la même conversation** dans le CLI. Agentopia devient temporairement en lecture seule et conserve le brouillon. Quitter Codex rend la saisie à Agentopia ; les nouveaux messages sont relus depuis l’historique local. Un second terminal ou un envoi concurrent est refusé. Sans Windows Terminal, une fenêtre PowerShell séparée est utilisée. Une session importée doit d’abord recevoir un message ici pour créer sa copie indépendante.

## Agentopia et l’application Codex

Une conversation Codex créée ici utilise un vrai thread persistant du CLI local. Agentopia conserve son identifiant et reprend ce thread aux messages suivants. Il hérite de `CODEX_HOME` (par défaut `~/.codex`) ; l’application Codex Windows utilise aussi ce dossier par défaut. Cela permet un stockage local commun, sans assurer à lui seul le même affichage dans les deux interfaces.

**L’historique natif Codex est consulté via app-server**, dans le même `CODEX_HOME`, pour les projets suivis. Les conversations cloud, archivées côté Codex ou appartenant à un autre dossier de données ne sont pas incluses. Choisir une conversation importe ses messages en lecture seule. Au premier envoi, Agentopia crée un fork et poursuit cette copie : la conversation d’origine reste inchangée. Une reprise native Claude CLI utilise également une copie de session. Ce n’est pas une synchronisation en direct des deux conversations.

L’apparition automatique des threads créés ici dans l’application Codex n’a pas été validée : les interfaces peuvent filtrer leurs listes différemment.

Les agents distincts n’ont pas automatiquement accès aux conversations des autres. **Passer à un agent** et les dépendances d’une **équipe mixte** transmettent explicitement les résultats. Deux agents de code peuvent voir les mêmes fichiers lorsqu’ils travaillent dans le même dossier ; les équipes utilisent des worktrees distincts.

Le **maître** utilise le fournisseur choisi dans Config ou un choix automatique parmi les outils configurés. Il ne génère rien au démarrage. Il peut proposer un plan mixte de 1 à 8 tâches, validé avant création/lancement. Les revues et messages de commit utilisent le fournisseur choisi ; les corrections de PR/CI utilisent l’agent de code choisi. Les nouvelles tâches planifiées enregistrent également leur fournisseur. Les anciennes planifications sans fournisseur restent explicitement Claude CLI, sans migration implicite vers une API payante. Le compte Claude CLI et la clé API Claude intégré sont deux connexions distinctes.

Références : [stockage local sous Windows](https://learn.chatgpt.com/docs/app/windows#share-config-auth-and-sessions-with-wsl), [historique et filtres app-server](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters).

Les tours tournent dans des processus séparés de l’interface. L’historique et l’identifiant de conversation du fournisseur sont conservés pour les messages suivants. Leur durée maximale est réglable (60 minutes par défaut, 1 à 180 minutes). Les conseils courts gardent leur plafond de deux minutes ; Perplexity garde son plafond de trois minutes, même si la limite globale est plus élevée.

## Missions, résultats et utilisation

Dans le détail d’un projet, **Mission** propose **Corriger un bug**, **Ajouter une fonction** ou **Analyser le projet**. Le projet ouvert est prérempli. L’agent par défaut est utilisé s’il peut travailler sur le code ; sinon le seul agent de code prêt est proposé automatiquement, ou un choix est demandé. La connexion est vérifiée avant lancement. L’analyse crée une conversation en lecture seule (sandbox Codex ; outils Read/Glob/Grep et mode plan Claude). Les parcours sont aussi accessibles par `/corriger`, `/fonction` et `/analyser`.

Après une erreur ou un arrêt, **Reprendre** renvoie la dernière demande avec l’historique ; **Reconnecter** ouvre la configuration du fournisseur. Un tour partiellement exécuté peut avoir déjà modifié des fichiers : la reprise est une nouvelle demande, pas une annulation des changements. **Bilan** montre le résumé de l’agent, les 50 dernières commandes observées et leurs codes de sortie lorsqu’ils sont fournis, l’état Git final et l’utilisation du dernier tour. Un résumé du modèle ou un dossier Git propre ne prouve pas que les tests ont réussi. Les anciennes sessions peuvent ne pas disposer de ces données.

**Config → Utilisation des agents** (`/utilisation`) rassemble les tours démarrés aujourd’hui, leurs jetons et les coûts USD rapportés. Un coût absent est indiqué **indisponible**, jamais zéro. Claude et Codex transmettent des compteurs cumulatifs : seule la différence avec la référence précédente est retenue. Un ancien historique repris sans référence peut avoir un premier tour incomplet. Les estimations du fournisseur ne sont pas une facture ; Codex n’est pas converti artificiellement en dollars. Le tableau `/cout` reste dédié à Claude CLI.

**Config → Limites des agents** (`/limites-agents`) règle le nombre maximal de tours démarrés par jour, partagé entre sessions intégrées et conseils, et la durée maximale d’un tour. Zéro tour signifie sans limite. Une réservation est enregistrée avant lancement, donc un démarrage échoué compte aussi. La limite de durée s’applique aux nouveaux tours ; les anciens conservent la leur. Ces limites ne contrôlent pas les sessions natives Claude CLI et ne constituent pas un plafond de facturation en dollars.

## Équipes

**Équipes → Nouvelle équipe**, `/equipe nouvelle` et `/equipe-mixte` ouvrent le même parcours guidé :

1. Développement → revue et vérification.
2. Reproduction d’un bug → correction → vérification (deux sessions).
3. Recherche Perplexity → développement → revue.
4. Un modèle enregistré ou un plan de 1 à 8 tâches composé à la main.

L’agent de code par défaut est proposé, sinon le seul agent disponible est choisi automatiquement. Un autre fournisseur de code disponible fait la revue ; si un seul est disponible, deux conversations distinctes du même fournisseur sont utilisées. **Changer les agents** permet de corriger ce choix. Les connexions nécessaires sont affichées dans l’aperçu et vérifiées au lancement. Les tâches indépendantes se lancent en parallèle, selon la limite de la configuration. L’ancien planificateur Claude CLI reste accessible avec `/equipe-cli`.

Le plan est enregistré avant tout appel. Ouvrir l’équipe, vérifier les missions, puis cliquer **Lancer**. Un dépôt Git avec un commit et un checkout propre est requis. Chaque tâche de code reçoit son propre worktree, basé sur les commits du dépôt. Les fichiers non suivis, variables d’environnement stockées dans des fichiers et modifications non commitées ne sont pas copiés.

**Actions (a) → Modifier le plan** ajuste l’objectif, le titre, la mission, le fournisseur et les dépendances de chaque tâche avant le premier lancement. **Enregistrer** conserve le plan sans démarrer d’agent ; **Annuler** abandonne le brouillon. Une dépendance circulaire est refusée et le brouillon précédent est conservé. Si une autre fenêtre modifie ou lance le plan pendant l’édition, l’enregistrement est refusé avec une explication. Une tâche requise par une autre ne peut pas être retirée tant que cette dépendance existe, et l’équipe doit garder au moins une tâche.

Au premier lancement, la base est actualisée vers le dernier commit du projet. Les reprises et nouvelles tentatives d’une équipe déjà lancée gardent leur base pour rester cohérentes avec le travail précédent.

**Actions (a) → Enregistrer ce plan comme modèle** conserve les missions, fournisseurs et dépendances. Le modèle est proposé à la création d’une autre équipe, qui demande un nouvel objectif. Il ne contient pas les anciens résultats, sessions, branches ou dossiers de travail. Le texte des missions est repris tel quel : vérifier les références propres au projet avant de créer le plan. **Config → Modèles d’équipe** (`/modeles-equipes`) permet de consulter ou retirer un modèle sans toucher aux équipes existantes.

Après une erreur ou un arrêt, **Débloquer (a) → Reprendre** poursuit la tâche dans la même conversation, branche et dossier, avec les fichiers partiels conservés. Il faut attendre l’arrêt effectif de l’agent et terminer les dépendances. La reprise est refusée si une tâche dépendante a déjà démarré, pour ne pas invalider son travail. **Recommencer dans de nouvelles branches** est une action distincte avec confirmation ; les anciennes tentatives sont conservées. Une tâche sans session récupérable utilise ce second parcours.

**Actions → Voir le bilan** (`/equipe-bilan`) rassemble résultats, blocages, dépendances attendues, branches et commandes observées au dernier tour de chaque session. Le coût couvre tous les jours des sessions actuellement rattachées à l’équipe ; les anciennes tentatives dans d’autres sessions sont exclues et les montants absents restent inconnus. Le bilan est copiable. Il distingue les résumés des agents des preuves d’exécution disponibles.

Les résultats et sources des dépendances sont transmis au prochain agent ; leurs branches sont fusionnées dans son worktree avant son lancement. Un conflit Git bloque la tâche. Une tâche n’est marquée terminée qu’après un succès explicite du fournisseur, un résumé non vide et, pour le code, un worktree propre. Cela ne constitue pas une preuve que les tests métier sont suffisants : lire les résultats et les diffs avant intégration.

Un moteur détaché unique par dossier de données lance les tâches suivantes, même après fermeture des fenêtres. Il retrouve les workers en cours après son redémarrage. Les réservations empêchent de rejouer une même tentative ; un lancement interrompu ou ambigu demande une vérification/reprise explicite. La création d’un plan Claude CLI reste liée à la fenêtre jusqu’à l’enregistrement du plan. **Intégrer** lance un agent dans le checkout principal après vérification qu’il est propre. Il fusionne les branches retenues et exécute les vérifications demandées. Aucun push automatique.

Le moteur refuse une seconde intégration d’équipe dans le même dossier tant que la première est active, même si son arrêt vient d’être demandé. Après un échec, **Reprendre l’intégration (a)** conserve la conversation, les fichiers partiels et une fusion Git en cours. La branche doit être celle enregistrée au début ; une branche détachée est refusée avant une nouvelle intégration. Une ancienne intégration sans branche enregistrée demande de vérifier et terminer le travail dans sa conversation. Une équipe de recherche sans branche à fusionner propose le bilan et le rangement. Les équipes déjà intégrées ne peuvent pas être relancées.

**Config → Moteur des équipes** (`/moteur`) affiche son état et sa version. `/tout-arreter` enregistre une pause persistante et demande l’interruption des équipes, des agents intégrés et des sessions natives en arrière-plan ; les onglets CLI interactifs restent indépendants. La pause bloque également les nouveaux tours intégrés et conseils. Reprendre le moteur ne relance pas les équipes arrêtées : utiliser **Débloquer → Reprendre** sur leur carte. Les permissions attendent toujours une réponse explicite. Les changements déjà effectués sont conservés.

Un moteur d’une ancienne version est remplacé automatiquement lorsqu’il est au repos. Si des équipes ou commandes sont en cours, Agentopia demande de les laisser finir ou de les arrêter avant la mise à niveau ; les commandes d’arrêt restent utilisables. La pause globale reste enregistrée après la mise à jour.

Le PC doit rester allumé. Aucun service de démarrage Windows n’est installé : après un redémarrage du poste, ouvrir Agentopia redémarre le moteur. Les tâches planifiées manquées sont rattrapées le même jour, avec une réservation préalable pour empêcher une double exécution automatique. Une erreur ou un crash laisse une trace consultable dans `/planifications` ; un nouvel essai manuel reste possible. Un processus de session disparu est signalé après deux minutes sans activité, jamais déclaré réussi.

Archiver conserve les transcripts et les worktrees ; leur nettoyage automatique n’est pas implémenté. Les sessions, réservations et worktrees sont dans `~/.claudetopia-agents/`. La configuration et les clés restent dans les fichiers Agentopia habituels. `CLAUDETOPIA_DATA_DIR` permet un répertoire de données indépendant, notamment pour les tests.

## Interface

Dans une session ouverte, le champ de message est fixé au bas de la colonne du chat, sous les messages et le diff éventuel. Il s’aligne avec la conversation, quelle que soit la position des actions. La barre générale reste disponible dans les autres vues et pour le maître. Changer de vue conserve les brouillons et leur destination.

Les bordures et indicateurs lumineux du Live et des cartes latérales restent stables ; les données continuent à se mettre à jour. Dans Projets, les caractères filtrent la liste. La barre indique ce contexte, explique qu’elle est en pause et garde le brouillon. Échap efface le filtre, puis revient à la barre. Pendant un tour d’agent, on peut préparer le prochain message sans l’envoyer prématurément.

La conversation sépare les actions du chat par une bordure. Les commandes ont un libellé lisible, un état, une durée lorsqu’elle est disponible et un aperçu de sortie. **Détails des outils** (Alt+L) affiche la commande exacte et la sortie conservée. Les tableaux Markdown s’adaptent à la largeur du terminal. Les mini-graphes des cartes et le soulignement des onglets latéraux ont été retirés.

Dans une session Codex intégrée, les fragments de réponse et les sorties de commandes sont affichés dès leur réception, avec un rafraîchissement de l’interface toutes les 200 ms. Seuls les événements exposés par Codex sont visibles, pas son raisonnement privé. Les sorties très volumineuses conservent leurs 128 000 derniers caractères et signalent cette limite. Pendant une reprise dans le terminal externe, l’historique est relevé toutes les 1,5 s ; sa disponibilité dépend des écritures du CLI. Un échec de relecture est signalé sans supprimer la conversation native.

Chaque conversation conserve son brouillon et ses pièces jointes, y compris après fermeture normale. La recherche Ctrl+F possède sa propre saisie ; Échap retrouve le message. Si un envoi échoue, son texte revient dans la conversation d’origine, même si une autre est ouverte. Les brouillons sont sauvegardés localement dans `~/.claudetopia-brouillons/` ; les recherches restent en mémoire. Les fichiers joints sont référencés par leur chemin, pas copiés.

Les flèches ↑ ↓ de l’historique retrouvent le brouillon après les anciennes commandes. Dans la recherche, elles parcourent les résultats, sans rappeler de commande ni modifier le terme recherché. Les envois sont verrouillés dès le premier appui sur Entrée, avant le prochain rendu, pour éviter les doublons.

**Pg↑ / Pg↓** font défiler les messages en gardant la saisie intacte. **Alt+Début** rejoint le début de l’historique chargé ; **Alt+Fin**, ou le lien **Derniers messages** affiché lorsqu’on remonte, retrouve la fin et le suivi automatique. Les nouveaux messages ne déplacent pas une lecture remontée. Changer de session ouvre son historique au dernier message. Un remplacement d’historique est détecté ; une indisponibilité temporaire conserve le dernier contenu lisible.

Une commande `/...` inconnue affiche des suggestions sans démarrer d’agent. Les chemins avec espaces s’écrivent entre guillemets, par exemple `/codex "C:\Mes projets\Application"`. Les actions des cartes et la palette ajoutent ces guillemets automatiquement.

Les choix, filtres, cases et champs sont propres à chaque dialogue. Les flèches, la frappe et Entrée peuvent s’enchaîner rapidement : la dernière sélection et le dernier texte sont ceux qui sont validés.

## Vérifier et réparer l’installation

- `/version` : version du paquet, branche, révision des sources, dossier utilisé et date de la dernière maintenance réussie. Une vérification ancienne ne certifie pas les modifications ultérieures.
- `/maj` : vérifie l’absence de modifications locales, récupère les sources, installe les dépendances Node et Bun, compile puis contrôle les types de l’interface. Ces étapes ont lieu même si Git répond « déjà à jour ».
- `/reparer` : exécute les mêmes étapes locales sans `git pull`. Permet de reconstruire une version en développement sans remplacer ses changements.

Les étapes de compilation ci-dessus concernent les installations depuis les sources. Avec le paquet Windows, `/maj` recherche une Release compatible, `/reparer` réinstalle le paquet conservé hors ligne et `/retour-version` réactive la version précédente. L’interface et les sommes de contrôle sont vérifiées avant activation. Relancer le logiciel après maintenance. [Distribution Windows](distribution-windows.md).

`/preparer` reprend la préparation du poste : projets, sélection des fournisseurs, outils requis, connexion et inventaire des conversations. `/scan` effectue un nouveau scan et conserve les projets déjà suivis. **Config → Agents à utiliser** permet de modifier les fournisseurs sélectionnés, y compris ceux reportés. Les choix sont enregistrés entre les étapes ; aucune clé ne se trouve dans ce reçu.

## Vérifications

```powershell
npm run test:ci
npm run test:agents
npm run check:tui
bun tui/test-agents.tsx
npm run test:qol
npm run test:stabilite
node test-codex-protocole.mjs
```

Les tests d’agents utilisent des transports simulés et un dépôt Git temporaire. Ils couvrent états, permissions, interruptions, erreurs, verrouillage, protocoles, sources, dépendances et isolation des branches. Le dernier diagnostic parle au vrai app-server Codex sans créer de conversation ni appeler de modèle. Aucun de ces tests ne valide une exécution payante chez Claude ou Perplexity.

La suite `test:ci` comprend aussi un moteur et des workers dans des processus séparés : unicité, arrêt brutal, reprise sur place, dépendances sans doublon, pause persistante et remplacement d’un ancien moteur au repos. Les tests d’utilisation couvrent les compteurs cumulés, le coût absent, les limites, les bilans et les réservations de planification. Les tests TUI vérifient les parcours clavier existants, la mission guidée, l’aperçu d’équipe, l’annulation et le bilan. Les modèles sont testés pour préserver leurs définitions, refuser les dépendances invalides et exclure les données des anciennes exécutions. Le workflow `.github/workflows/validation.yml` lance cette suite sous Windows à chaque push/PR ; il ne publie aucun paquet et n’appelle aucun modèle.

Références : [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Perplexity Agent API](https://docs.perplexity.ai/docs/agent-api/quickstart).

Diagnostics de connexion : [catalogue Claude](https://platform.claude.com/docs/en/api/models/list), [catalogue Perplexity dans son SDK officiel](https://github.com/perplexityai/perplexity-node/blob/main/api.md).

## Récupération après interruption (1.3.1)

Un worker disparu passe en erreur ; **Reprendre** conserve sa conversation, sa branche et ses fichiers. Un verrou abandonné avant l’apparition du worker est récupéré après deux minutes au prochain scan ou envoi. Un worker encore vivant garde l’exclusivité, même pendant le nettoyage final. La détection tient compte du redémarrage du PC pour les nouveaux workers.

La fin tardive d’une demande d’autorisation, après une interruption ou une limite de durée, ne remet plus le tour en « travaille ». Les événements tardifs du fournisseur sont ignorés dès que le tour est terminé.

Les équipes sont vérifiées à la lecture et sauvegardées avant chaque écriture dans `claudetopia-equipes.json.sauvegarde`, à côté de leur fichier habituel (préfixé d’un point dans le profil utilisateur). Cette copie représente la version précédente ; elle peut donc être antérieure aux dernières actions. Un fichier invalide n’est jamais remplacé par une liste vide.

**Équipes → Récupérer les équipes**, ou `/equipes-recuperer`, présente la date et le nombre d’équipes de la sauvegarde. Restaurer met le moteur en pause et demande l’interruption des sessions intégrées ; l’ancien fichier est conservé sous un nom `.recup-…json`. Les conversations et worktrees ne sont pas supprimés. Vérifier leurs résultats avant de reprendre le moteur ou les tâches. Les anciens agents Claude CLI externes ne sont pas arrêtés par cette récupération.

Sans sauvegarde valide, aucune restauration n’est proposée : le fichier original reste intact. Après restauration d’une copie personnelle, **Réessayer la lecture** recharge les données sans redémarrer l’interface.
