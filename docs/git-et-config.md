# Commits Git et recherche des réglages

## Préparer un commit

Dans un projet, lance `/commit`. Agentopia propose d’abord **Écrire mon message**, sans connexion à un fournisseur. **Proposer un message avec un agent** reste disponible et permet de choisir le fournisseur.

L’aperçu indique le projet, la branche et les fichiers indexés. S’il n’y a rien dans l’index, l’application demande avant de lancer `git add -A`. Les fichiers non indexés ne sont pas ajoutés à un index déjà préparé.

La dernière confirmation permet de modifier le message, committer, committer puis pousser, ou annuler. Les messages multilignes et les caractères accentués sont conservés. Les hooks Git restent actifs.

Si l’index, la branche ou HEAD a changé pendant la préparation du message, Agentopia refuse le commit et demande de recommencer avec un nouvel aperçu. Cette vérification ne verrouille pas les autres outils Git : évite de modifier simultanément le même dépôt pendant la création du commit.

## Pendant une opération

L’indexation, le commit et le push affichent une commande d’interruption. Entrée ou Échap interrompt l’opération. Les lectures ont un délai court ; chaque commande de modification est limitée à deux minutes. La sortie des processus est bornée et l’interface reste disponible pendant leur exécution.

Une indexation ou un commit échoué ne déclenche pas de push. Après un commit réussi, un push interrompu conserve le commit et affiche **Envoi non confirmé** : vérifie le distant avant de réessayer. Une interruption n’annule pas les écritures déjà effectuées par Git ou ses hooks. Quitter l’application demande aussi l’arrêt des processus Git qu’elle a lancés.

`/revue` lit les changements avec le même exécuteur asynchrone avant de demander une analyse à l’agent choisi. Les nouveaux fichiers non suivis sont signalés par leur nom ; leur contenu n’est pas envoyé dans cette revue.

## Retrouver un réglage

Dans **Config**, tape `/` puis des mots comme `github`, `modèles équipe` ou `terminal`. La recherche porte sur les sections, les libellés, les valeurs et les actions, sans imposer les accents.

- ↑ / ↓ : sélectionner un résultat ; Entrée : ouvrir son réglage.
- Retour arrière : effacer un caractère ; Ctrl+U : vider la recherche.
- Échap : effacer la recherche, puis revenir à l’application.
- Sans recherche active, `q` ferme Config.

La valeur sélectionnée apparaît sous la liste. Les colonnes s’adaptent à la place disponible dans les interfaces Ink et OpenTUI. Les réglages et leur disposition générale restent les mêmes.
