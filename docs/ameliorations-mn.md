# Stabilisation et confort — bêta 13

Les identifiants M1–M12 et N1–N8 correspondent aux priorités de l’audit multi-agent. La disposition des écrans est conservée. Cette version ajoute les parcours suivants ; les preuves de validation et limites de publication figurent à la fin du document.

| Point | Changement et accès |
|---|---|
| M1 | Le compte GitLab est associé à une origine HTTPS précise dans `/connecter gitlab`. Un ancien compte doit être associé avant utilisation. Les redirections authentifiées restent sur cette origine. |
| M2 | Le coffre refuse les lectures impossibles ou incohérentes avant de modifier une clé. Écritures atomiques, verrou et sauvegarde ; `/recuperer-coffre` conserve le fichier endommagé. |
| M3 | `!commande` utilise le dossier affiché. Les corrections de PR/CI préparent une branche et un worktree dédiés, sans déplacer la branche principale. |
| M4 | La saisie garde les nouvelles lignes et l’indentation. Entrée envoie ; Ctrl+J ou Maj+Entrée insère une ligne selon les capacités du terminal. Les brouillons restent propres à chaque conversation. |
| M5 | Des reçus de planification illisibles bloquent les départs. `/planifications-recuperer` conserve l’original et évite de rejouer automatiquement les tâches du jour. |
| M6 | Un conflit pendant la préparation reste dans son worktree. La reprise réutilise ce dossier au lieu de créer une nouvelle branche à chaque essai. |
| M7 | La sélection suit le défilement dans les listes au clavier. Les présentations compactes restent utilisables dans un petit terminal. |
| M8 | Les processus Git sont asynchrones, bornés et annulables. Une absence de Docker/SSH est signalée au lieu de provoquer une exception non traitée. |
| M9 | Récupération des sessions, import réglages/SSH journalisé et réversible, sauvegarde du profil avec `/sauvegarder` et restauration avec `/restaurer-sauvegarde`. |
| M10 | Le scan actualise les projets déjà affichés. Sans fournisseur prêt, la préparation explique le mode exploration et la connexion à terminer. |
| M11 | Le bilan conserve les tentatives et leur utilisation connue. Le plafond par équipe est distinct du plafond global. |
| M12 | Sources, README et version publiée alignés ; maintenance des installations Windows et chemin de signature préparé. Une signature exige toujours un certificat d’éditeur externe. |
| N1 | Live présente les fournisseurs intégrés et leurs coûts connus ; une valeur absente reste inconnue. Claude et Codex publient des événements progressifs ; Perplexity signale que son transport actuel ne diffuse pas les étapes de recherche. |
| N2 | `/preparation-projet` montre les commandes de préparation et les fichiers locaux choisis. Les prochains worktrees réutilisent ce profil explicite avec journal et limites. |
| N3 | `/modele-agent` règle le défaut d’un fournisseur ; l’action Modèle du chat ou `/modele-session` règle une session ; les tâches ont leur modèle. Les capacités et transports sont centralisés. |
| N4 | `/limites-equipes` distingue maximum par équipe, global et par fournisseur. `/file-agents` explique les attentes et permet d’annuler une tâche en attente. |
| N5 | Recherche complète de conversation, chargement des messages antérieurs, recherche entre conversations et `/export-conversation` en Markdown ou JSONL. |
| N6 | `/diagnostics` prévisualise un rapport technique local borné, persistant après incident, sans copier les conversations, les clés ou les chemins personnels. Aucun envoi automatique. |
| N7 | Relire → Vérifier reconnaît les scripts JS/TS, pytest/unittest, .NET et les commandes explicites du projet dans `agentopia.json`. |
| N8 | Les recettes Comparaison et Revue croisée produisent des avis indépendants puis une synthèse. Le plan fixe le nombre de passages et expose les transmissions. |

## Modèles et fournisseurs

Un identifiant de modèle est transmis au fournisseur choisi au prochain tour. Agentopia ne garantit pas qu’un identifiant saisi soit disponible pour le compte ; le fournisseur le vérifie. Vider le choix d’une session revient au modèle du fournisseur. Les conversations existantes gardent leur choix lorsque le défaut global change. Le transport Agent API de Perplexity sélectionne automatiquement ses modèles : aucun menu ne prétend lui appliquer un modèle arbitraire.

Le registre central décrit le code, les fichiers, les commandes, la recherche, la reprise, le flux, les permissions et le choix du modèle. Ajouter un fournisseur nécessite encore son adaptateur, sa connexion et des tests ; ce n’est pas un chargement automatique de plugins non vérifiés.

## Vérifications Python, .NET et commandes du projet

Les outils doivent déjà être installés. Python utilise l’environnement accessible dans le PATH ; aucun paquet Python n’est installé implicitement. Les commandes `.NET test` utilisent `--no-restore` : prépare les dépendances avant la vérification. Les scripts du projet peuvent eux-mêmes effectuer des téléchargements ou des modifications ; la commande et ses arguments sont affichés avant l’accord.

Exemple de `agentopia.json` à la racine d’un projet :

```json
{
  "verifications": [
    { "nom": "python-unitaires", "programme": "python", "args": ["-m", "unittest", "discover", "-s", "tests"] },
    { "nom": "dotnet", "programme": "dotnet", "args": ["test", "Tests.csproj", "--no-restore"] }
  ]
}
```

Le programme est résolu dans le PATH et les arguments sont transmis séparément. Le manifeste est relu avant exécution : une modification oblige à choisir de nouveau la commande. Chaque vérification conserve durée, journal, code de sortie et empreinte du projet. Un code zéro n’est pas une certification de qualité fonctionnelle.

## Sauvegarde et confidentialité

La sauvegarde inclut les données Agentopia : réglages, équipes, conversations intégrées, brouillons, modèles, reçus et preuves. Elle exclut le coffre de secrets, les authentifications des CLI, les dépôts/worktrees et les fichiers joints externes. Les conversations et les journaux peuvent contenir des données de projet : conserve la sauvegarde dans un emplacement privé. Les limites de taille sont annoncées et une sauvegarde trop grande échoue explicitement.

La restauration se fait au repos et conserve un journal permettant d’annuler les remplacements. Les planifications et préparations automatiques importées ne repartent pas d’elles-mêmes. Les références vers les projets et pièces jointes doivent encore exister sur le poste de destination. Les historiques Codex externes deviennent recherchables après leur import explicite.

Le rapport `/diagnostics` contient uniquement des événements techniques structurés : opération, code d’erreur, version et corrélation hachée. Il n’inclut ni texte libre des agents ni journaux bruts des SDK. L’export de conversation est une action séparée, choisie par l’utilisateur.

## Limites de validation

Les appels Claude et Perplexity sont simulés dans les tests automatisés ; leur validation avec comptes réels reste distincte. La préparation des worktrees exécute des commandes du projet avec les droits de l’utilisateur après configuration explicite. Une mise à jour Windows préserve les données, mais ne remplace pas une sauvegarde privée des dépôts. La préparation de signature ne donne pas à elle seule une réputation SmartScreen.

La file automatique concerne les équipes et les planifications. Un nouveau message manuel au-delà du plafond est refusé avec une explication ; son brouillon reste disponible. Les coûts des tentatives sont cumulés à partir des reçus conservés ; des tentatives antérieures à cette mise à niveau peuvent manquer de métadonnées. Les recettes ont une fin explicite : comparaison en trois tâches, revue croisée en quatre tâches, sans boucle autonome infinie.

Le moteur et les préparations Git sont asynchrones et annulables. Quelques lectures courtes des anciennes vues restent synchrones, avec une limite de dix secondes et une sortie bornée. Les sauvegardes sont limitées à 128 Mio de données, 32 Mio par fichier et 50 000 fichiers ; l’archive JSON est limitée à 256 Mio.
