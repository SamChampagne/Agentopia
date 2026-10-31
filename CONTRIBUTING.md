# Contribuer à Agentopia

Le [suivi GitHub obligatoire v2](docs/github-workflow.md) complète ce guide : toute tâche doit être décrite, estimée, rattachée au projet et suivie jusqu’à la clôture.

Standard commun, version 2 — 31 octobre 2026.

## Parcours obligatoire des changements

1. Lire [AGENTS.md](AGENTS.md), [l'état du dépôt](docs/etat-du-projet.md) et les règles locales du dossier concerné. Inspecter branche, statut, worktrees, remote et PR avant de toucher au code. Conserver tout travail existant.
2. Rechercher une issue existante. Sinon en créer une avec observation/besoin, périmètre, critères et preuves. Ne pas présenter une hypothèse comme un bug reproduit.
3. Ajouter l'issue au [projet Agentopia](https://github.com/users/SamChampagne/projects/4), priorité P1/P2/P3, statut **Todo**. Passer à **In Progress** lorsque le travail commence. P1 = fiabilité/base bloquante, P2 = amélioration planifiée, P3 = ultérieur.
4. Partir de la base vérifiée dans un worktree/clone isolé si nécessaire. Utiliser `codex/<numero>-<sujet>` pour une nouvelle branche; conserver une branche existante lors d'une reprise. Aucun reset destructif ou stash imposé au travail d'autrui.
5. Faire un changement cohérent, tenir la documentation à jour et exécuter les contrôles adaptés. Noter commandes, résultats, environnement et limites. Les tests locaux, la CI, une publication et la validation réelle par l'utilisateur sont des preuves distinctes.
6. Ouvrir une PR vers la base canonique avec `Closes #N`, les sections **Validation** et **Limites**, et les liens utiles. Une simple consultation n'exige pas de PR. Une correction de code ou de documentation passe par ce parcours.
7. Relire le diff et la CI du dernier commit. Fusionner selon les autorisations données et les règles du dépôt; aucun contournement silencieux d'un contrôle en échec. Si l'accès GitHub manque, préparer le travail local et signaler précisément ce qui n'a pas été publié.
8. Après fusion, vérifier le SHA distant et la fermeture de l'issue, puis mettre **Done** dans le projet. Supprimer la branche seulement si sa tête est intégrée, inchangée, non protégée et inutilisée par un worktree/une PR. Conserver un manifeste nom/SHA pour un nettoyage groupé. Une branche divergente reste conservée jusqu'à décision explicite.

## Projet GitHub

Configuration non secrète : [.github/project.json](.github/project.json). L'agent utilise son accès GitHub existant. L'automatisation utilise le secret chiffré dédié `PROJECTS_TOKEN`; aucune valeur de jeton ne doit apparaître dans les fichiers versionnés.

```sh
gh issue list --repo SamChampagne/Agentopia
gh project item-add 4 --owner SamChampagne --url https://github.com/SamChampagne/Agentopia/issues/NUMERO
gh project item-list 4 --owner SamChampagne --format json
```

Pour changer le statut, relever l'ID de l'item, puis utiliser `gh project item-edit --id ITEM_ID --project-id PROJECT_ID --field-id STATUS_FIELD_ID --single-select-option-id OPTION_ID`. Les IDs/champs sont dans la configuration; revérifier les champs s'ils ont changé. Les règles GitHub de fermeture peuvent aider, mais l'agent doit vérifier le résultat.

## Contrôles du standard

```sh
node --test .github/scripts/check-development.test.mjs
node .github/scripts/check-development.mjs
git diff --check
```

Le workflow **Standard de développement** vérifie les chemins des liens Markdown des entrées racines et de `docs/`, puis la présence d'une vraie issue du dépôt et de rubriques de validation/limites dans les PR. Les ancres et URL externes ne sont pas vérifiées. Les guides produit conservés ailleurs restent à relire lors d'un changement les concernant.

Le contrôle complémentaire `workflow-projet` vérifie l'appartenance au projet privé, les estimations, les descriptions, les liens natifs et les statuts. Ces contrôles ne valident pas la qualité du code ou du produit. Les agents doivent encore exécuter les contrôles décrits dans [l'état du projet](docs/etat-du-projet.md). Aucune protection serveur de branche n'est supposée active sans vérification.

## Documentation

- `README.md` : accès rapide et installation.
- `docs/README.md` : index; `docs/etat-du-projet.md` : état vérifié et limites.
- GitHub Issues/Projects : tâches et avancement courants; éviter un TODO parallèle.
- `docs/maintenance/` : inventaires et traces de nettoyage datées.
- Les guides et rapports existants conservent leurs chemins pour préserver les liens publiés. Un rapport daté décrit sa révision, pas nécessairement l'état actuel.
