# Choisir son compte GitHub

Dans **Config → Compte GitHub**, **Connexions → Compte GitHub** ou avec `/compte github`, choisis le compte voulu puis appuie sur Entrée. Agentopia affiche les comptes github.com déjà enregistrés dans GitHub CLI sur cet ordinateur, par exemple `SamChampagne` et `SamChampagneIntebec`.

Le compte choisi apparaît dans Config. **Échap** annule sans modifier le réglage. La connexion et l’identité sont vérifiées avant l’enregistrement ; une erreur conserve le choix précédent. Si un compte devient indisponible, l’action échoue avec une indication de reconnexion, sans prendre un autre compte en secours.

## Ce qui suit le choix

- Les PR, tickets, pipelines GitHub Actions et dépôts distants consultés par Agentopia.
- Les opérations Git HTTPS vers github.com lancées par les commandes de l’application : clone, fetch, pull et push.
- Les nouvelles lectures après le changement : les résultats de l’ancien compte sont retirés, et une requête tardive ne les réaffiche pas.

Le réglage est commun aux projets ouverts dans ce profil Agentopia. Ce n’est pas encore une préférence différente pour chaque projet. Une opération déjà commencée continue avec son compte de départ.

Les remotes **SSH** utilisent toujours leur clé SSH. Le **nom et l’adresse des commits** restent dans **Config → Identité Git**. Les terminaux externes, commandes libres et commandes exécutées directement par un agent conservent leur propre configuration Git/GitHub. Choisir un compte dans Agentopia ne change pas le compte actif de GitHub CLI dans les autres outils.

## Connexion et retour au réglage précédent

GitHub CLI absent : **Connexions → Outils → GitHub CLI** propose son installation sous Windows. Pour enregistrer un compte supplémentaire sur l’ordinateur, utilise `gh auth login --hostname github.com`, puis rouvre le sélecteur. Un compte absent du coffre GitHub CLI ne peut pas être déduit du nom d’un fichier de clé SSH.

**Réglage habituel du poste** retire la préférence Agentopia : les API retrouvent le jeton Agentopia existant, et Git sa configuration habituelle. **Gérer un jeton dans Agentopia** conserve la connexion manuelle chiffrée pour ceux qui n’utilisent pas GitHub CLI.

## Protection des clés et validation

La configuration Agentopia ne contient que le nom du compte choisi. Les clés GitHub CLI restent dans leur stockage existant et sont récupérées en mémoire. Leur identité est confirmée auprès de GitHub avant utilisation. Le helper Git n’en fournit que pour HTTPS sur github.com ; aucune clé n’est placée dans les arguments de Git ou dans sa configuration globale.

Les variables `GH_TOKEN` et `GITHUB_TOKEN` héritées du terminal ne remplacent pas un compte explicitement choisi. Voir la [priorité des variables GitHub CLI](https://cli.github.com/manual/gh_help_environment).

Les tests isolent le stockage système : modifier `GH_CONFIG_DIR` seul ne suffit pas à isoler le coffre natif. La couverture comprend les annulations, erreurs d’identité, refus d’un autre domaine, dialogue réel avec Git à clé factice, résultats tardifs et clavier à 60/80/130 colonnes. Les vérifications des deux comptes locaux réels sont en lecture seule ; elles ne constituent pas un essai de push sur un dépôt privé.
