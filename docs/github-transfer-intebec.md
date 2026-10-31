# Préparer le transfert futur vers Intebec

Cette procédure prépare un **transfert natif GitHub**, sans déplacer de dépôt maintenant. Destination : organisation **Intebec**, administrée par le compte personnel **SamChampagneIntebec**. Ce sont deux identités différentes; les futures URLs des dépôts seront `https://github.com/Intebec/NOM`.

## Ce qui est déjà portable

Le workflow résout le dépôt par `repositoryId`, puis utilise le propriétaire et le nom actuels renvoyés par GitHub. Dans Actions, il vérifie également `GITHUB_REPOSITORY_ID` et `GITHUB_REPOSITORY`. Seuls les propriétaires SamChampagne et Intebec sont autorisés; une copie portant un autre ID est refusée.

Le tableau est recherché par son ID Projects. Son propriétaire, numéro et URL sont relus. Un transfert natif conservant cette identité peut donc changer son numéro ou son adresse. Une copie est un autre tableau : elle nécessite une migration explicite des cartes et de la configuration, jamais une sélection approximative par titre. Si GitHub ne conserve pas une identité lors du transfert choisi, le contrôle échoue et demande une mise à jour vérifiée de la configuration.

Les accès Projects sont essayés séparément : `PROJECTS_TOKEN_INTEBEC`, puis `PROJECTS_TOKEN` actuel. Cela permet de transférer dépôt et tableau en deux étapes avec leurs accès respectifs. L’absence d’accès utilisable maintient le contrôle en échec. Aucun secret ne donne lieu à l’exécution du code d’une PR : script et configuration viennent toujours de main.

## Prérequis avant le jour du transfert

1. **Droit de transfert.** Le 31 octobre 2026, SamChampagne possède les dépôts mais n’est pas membre d’Intebec; SamChampagneIntebec est propriétaire d’Intebec mais n’administre pas les dépôts sources. Donner au compte qui effectue le transfert les droits nécessaires dans les deux emplacements. Le parcours « Move work to an organization » du compte SamChampagne exige notamment le droit de créer des dépôts dans Intebec. Aucun accès de membre n’est modifié par cette préparation.
2. **Accès des collègues.** Intebec a actuellement un accès de base `write` pour ses membres. Réexaminer les personnes qui recevront accès aux dépôts transférés; aucun réglage global d’organisation n’est modifié ici.
3. **Jeton dédié futur.** Sous SamChampagneIntebec, créer un PAT classique dédié avec `repo` et `project`, une expiration adaptée et l’autorisation SSO si l’organisation l’exige. Depuis un terminal où le compte source SamChampagne est connecté à `gh`, exécuter le script ci-dessous. Il vérifie l’identité et les scopes et enregistre le secret futur dans les quatre dépôts, sans toucher au secret actuel. Ne jamais mettre le jeton dans le chat ou un fichier.
4. **Offre et règles.** Intebec est actuellement sur GitHub Free. Agentopia reste public et sa protection peut être conservée; les trois dépôts privés n’ont pas de protection serveur disponible sur cette offre. Pour les rendre obligatoires côté serveur, il faut une offre organisation compatible, choisie par le propriétaire. Ne pas rendre un dépôt public pour contourner cette limite.
5. **Préparation des agents.** Après transfert, utiliser le compte prévu dans GitHub CLI et autoriser `project` si nécessaire : `gh auth switch --user SamChampagneIntebec`, puis `gh auth refresh -s project`. Le secret Actions ne donne pas automatiquement ce droit au poste local.

```powershell
& .github/scripts/set-intebec-project-token.ps1
```

Vérifier ensuite le jeton futur dans GitHub Actions, sans transfert, avec le workflow **Suivi du projet**, option `check_destination_access=true` :

```sh
gh workflow run project-tracking.yml -f check_destination_access=true
```

Ce test confirme le compte, son rôle et la lecture Projects de l’organisation. Il ne prétend pas avoir déjà testé l’écriture sur un tableau qui n’a pas encore été transféré.

## Inventaire juste avant de déplacer

Terminer les PR en cours ou convenir d’une fenêtre sans écritures pour pouvoir comparer les données. Préserver les branches divergentes et les worktrees. Les copies locales ayant du travail non commité ne doivent pas être réinitialisées.

Depuis une copie à jour de chacun des quatre dépôts :

```sh
node .github/scripts/migration-audit.mjs snapshot ../NOM-avant-transfert.json
```

Choisir un fichier neuf; l’outil refuse d’écraser un inventaire. Il lit les identités, branches/tags/SHA, métadonnées et empreintes des issues/PR, releases/assets, cartes/champs/vues/automatisations Projects, noms de secrets, empreintes des variables, protections, permissions Actions, environnements, webhooks et clés de déploiement disponibles. Aucune valeur de secret ni jeton n’est exportée. Les données non accessibles sont indiquées comme inconnues; une erreur API ne signifie pas « aucune règle ».

L’inventaire est une preuve de comparaison, pas une sauvegarde exhaustive des discussions, fichiers LFS, artefacts Actions ou services externes. Conserver les sauvegardes et procédures habituelles de ces services.

## Transfert manuel prévu

Depuis le compte source : **Settings → Organizations → Move work to an organization**. Sélectionner les quatre dépôts **et les quatre Projects**, puis Intebec. Conserver leurs noms et visibilités. Ne pas utiliser un nouveau dépôt suivi d’un `git push --mirror`, qui ne transfère pas les issues, PR et réglages.

Si le parcours global n’est pas disponible, transférer les dépôts et les tableaux par les fonctions natives disponibles; valider chaque identité. Ne pas confondre « transférer » et « copier un projet » : une copie n’emporte pas automatiquement les issues existantes, collaborateurs et liens au dépôt.

Ne pas recréer les anciens dépôts sous SamChampagne : cela peut casser les redirections. Ne supprimer aucun ancien tableau tant que les cartes, valeurs et références n’ont pas été vérifiées.

## Vérification après transfert

1. Mettre à jour seulement l’URL du remote de chaque copie existante : `git remote set-url origin https://github.com/Intebec/NOM.git`. Cette commande ne change ni les fichiers ni les branches locales. Vérifier l’accès du compte connecté.
2. Relire le dépôt par son ID et le tableau par son ID. Vérifier que les numéros d’issues/PR et leurs discussions sont conservés et que les personnes encore assignées sont membres ou autorisées dans l’organisation.
3. Comparer avec l’inventaire frais, depuis une copie à jour :

```sh
node .github/scripts/migration-audit.mjs verify ../NOM-avant-transfert.json ../NOM-apres-transfert.json
node .github/scripts/project-workflow.mjs sync
gh workflow run project-tracking.yml -f check_destination_access=true
```

4. Examiner chaque écart et chaque contrôle indisponible. Les noms/numéros de tableau et les URLs peuvent changer; les identités et données suivies doivent correspondre. Des modifications concurrentes légitimes peuvent également produire un écart : les qualifier plutôt que remplacer l’inventaire pour obtenir du vert.
5. Vérifier les protections : PR obligatoire, branche à jour et contrôles attribués à GitHub Actions. Pour Agentopia : `documentation`, `suivi-pr`, `verifier`, `workflow-projet`, administrateurs inclus, pas de force-push/suppression. Pour les dépôts privés, vérifier l’offre avant d’affirmer un blocage serveur.
6. Valider une vraie PR liée à une issue estimée : Todo → In Progress → In Review → Done; contrôler également Blocked. Vérifier que les liens et statuts pointent vers le tableau Intebec.
7. Exécuter les CI propres à chaque produit et une validation de livraison adaptée. Les défauts de CI existants restent des défauts à traiter séparément; transférer le dépôt ne les corrige pas.

## CI/CD et intégrations à contrôler

Les workflows versionnés suivent le dépôt. GitHub indique que les issues, PR, secrets de dépôt, webhooks et clés de déploiement sont conservés lors d’un transfert; les politiques de l’organisation s’appliquent ensuite. Cela ne garantit pas que les services externes acceptent automatiquement le nouveau propriétaire.

- Vérifier les Actions autorisées, permissions du `GITHUB_TOKEN`, secrets et variables de dépôt/environnement, runners, approbations et accès des GitHub Apps (dont les connecteurs des agents).
- Vérifier les webhooks et les plateformes d’hébergement qui filtrent un slug de dépôt, ainsi que les éventuelles règles OIDC basées sur `repo:PROPRIETAIRE/NOM`.
- Les packages à permissions indépendantes (notamment GHCR/npm) ne changent pas automatiquement de namespace avec le dépôt; vérifier leur liaison et les droits de lecture/publication avant d’utiliser le nouveau nom.
- Aucun pipeline de déploiement applicatif absent n’est créé par cette préparation. Pulsar dispose de CI et de procédures de déploiement distinctes; Cadence et le main historique de PlaniAdvanceV2 ont surtout les contrôles du standard. Agentopia a sa validation Windows et sa publication de bêta sur tags.

Références : [transfert de dépôt](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository), [déplacement des dépôts et Projects vers une organisation](https://docs.github.com/en/account-and-profile/how-tos/account-management/moving-your-work-to-an-organization), [limites d’une copie de Project](https://docs.github.com/en/issues/planning-and-tracking-with-projects/creating-projects/copying-an-existing-project), [permissions des packages](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages).

## Compatibilité des installations Agentopia

Le client préparé interroge les releases par l’ID stable du dépôt et accepte uniquement les assets de SamChampagne/Agentopia ou Intebec/Agentopia, sans mélanger les propriétaires. Les nouveaux paquets CI utilisent le nom courant du dépôt fourni par GitHub Actions.

**Avant de transférer**, publier puis distribuer une version contenant cette compatibilité. Les anciennes installations ont encore leur ancienne liste d’URLs; modifier main ne les met pas à jour. Après transfert, tester recherche de mise à jour, téléchargement, checksum/signature et installation sur un profil Windows jetable. Cette préparation ne publie pas de nouvelle version et ne lance aucun installateur sur les profils personnels.
