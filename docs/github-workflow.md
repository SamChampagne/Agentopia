# Suivi obligatoire des tâches et PR

Standard commun v3, 31 octobre 2026. Il s'applique aux agents et aux contributeurs de ce dépôt.

## Avant de modifier le dépôt

1. Lire AGENTS.md et les règles métier du dossier; vérifier branche, statut, worktrees et travaux existants.
2. Rechercher l'issue existante. Pour tout nouveau changement (code, documentation, configuration ou tests), créer une issue avec le formulaire **Tâche** ou **Bug**. Une question purement informative ne crée pas de tâche artificielle.
3. Décrire le besoin, le périmètre et les critères vérifiables; préciser validation prévue, priorité, estimation d'effort positive en heures et hypothèses. Un bug contient reproduction ou preuve datée. Les estimations sont révisables et excluent les attentes; au-delà de 80 h, décomposer en issues distinctes.
4. Ajouter la tâche au projet attendu et démarrer avec la commande ci-dessous. Sans accès GitHub, préparer l'analyse et le contenu local, mais signaler le blocage : ne pas annoncer un suivi effectué ou une livraison prête à fusionner.
5. Utiliser `codex/<numero>-<sujet>` pour une nouvelle branche isolée; conserver les branches et fichiers d'une reprise. Ne pas effacer le travail d'autrui.

```sh
# L'agent peut aussi utiliser le formulaire GitHub ou gh issue create.
node .github/scripts/project-workflow.mjs create tache.md "Titre concret"
node .github/scripts/project-workflow.mjs start NUMERO
```

Le fichier de création utilise les rubriques exactes du formulaire. La CLI refuse une issue incomplète, crée sa carte dans le bon projet et enregistre le démarrage. Elle utilise l'authentification GitHub CLI déjà connectée; aucun jeton n'est écrit dans le dépôt.

## Pendant le travail

- Maintenir la description et les critères; réestimer dès que le périmètre ou une hypothèse change. Expliquer la révision dans l'issue, sans remplacer l'estimation par le temps d'attente.
- Le statut **In Progress** doit correspondre à un travail réellement commencé. Le label `workflow:started`, posé par la commande start, sert de source durable pour la synchronisation.
- En cas de blocage, décrire l'obstacle et l'action nécessaire. Ne pas classer la tâche Done pour s'en débarrasser.

```sh
node .github/scripts/project-workflow.mjs block NUMERO "Obstacle précis et action nécessaire pour reprendre"
node .github/scripts/project-workflow.mjs start NUMERO
```

La reprise retire le label de blocage; son explication reste dans l'historique de l'issue. Les statuts du tableau sont synchronisés depuis les issues et PR : utiliser ces commandes plutôt qu'une modification manuelle isolée du tableau.

## PR et fin du travail

1. Ouvrir une PR vers la branche principale avec `Closes #N` pour chaque issue réellement traitée. Une référence dans un commentaire HTML, un exemple de code ou une simple mention ne suffit pas. GitHub doit reconnaître le lien natif.
2. Renseigner **Validation** (commandes et résultats observés) et **Limites**. Relire les critères de l'issue, cocher seulement ceux vérifiés et garder les travaux restants dans des issues distinctes estimées.
3. Une PR brouillon place ses tâches en **In Progress**; prête à relire, en **In Review**. Une tâche **Blocked** empêche le contrôle projet de devenir vert.
4. Le contrôle `workflow-projet` lit l'issue et le projet réels : description, critères, estimation/hypothèses, validation prévue, priorité, carte active et statut cohérents. Il reste rouge si l'accès Projects manque; aucune URL ou déclaration dans la PR ne remplace cette vérification.
5. Fusionner uniquement avec les contrôles requis verts et l'autorisation applicable. Après fusion, vérifier fermeture de l'issue et **Done** dans le projet. Une PR fermée sans fusion ne clôture pas sa tâche. Pour un travail sans PR, documenter la preuve avant de fermer; pour un abandon, utiliser explicitement le motif « non prévu ».
6. Ranger uniquement les branches intégrées, inchangées et inutilisées. Préserver les SHA pour un nettoyage groupé.

```sh
# Réconcilier le tableau et réévaluer toutes les PR ouvertes après une correction.
node .github/scripts/project-workflow.mjs sync
```

## Automatisation et droits

`.github/project.json` contient les IDs stables du dépôt, du projet et des champs. Les noms de propriétaire et URLs courants sont résolus via GitHub; les valeurs stockées sont le point de départ historique. Les champs de description restent dans l'issue (source de vérité); l'estimation et la priorité sont reflétées dans le tableau. Les anciennes tâches clôturées sont conservées sans inventer d'estimation historique.

Le workflow **Suivi du projet** réagit aux issues et PR, et peut être lancé manuellement. Il réconcilie l'état courant, y compris lorsque plusieurs événements se regroupent. Les issues incomplètes reçoivent `workflow:needs-planning`. Une carte archivée doit être désarchivée explicitement avant de reprendre.

GitHub Projects d'un utilisateur exige un secret Actions `PROJECTS_TOKEN` avec les scopes `project` et `repo` pour les dépôts privés. Utiliser un jeton dédié, avec expiration et rotation suivies; ne jamais le coller dans une issue, un chat ou un fichier versionné. Le jeton Actions ordinaire ne peut pas accéder à Projects. [Référence officielle](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions).

Le workflow privilégié utilise uniquement script/config de la branche principale; il ne charge, compile ni exécute le code d'une PR. Les actions sont fixées à leurs SHA; le jeton Projects n'est fourni qu'à l'étape de synchronisation. Le jeton Actions du dépôt porte les écritures de statuts et labels. Aucune installation npm, aucun modèle payant et aucune tâche planifiée récurrente n'est ajoutée.

Ajouter `workflow-projet` aux contrôles obligatoires de main après validation du workflow et du secret. Sur un dépôt privé dont l'offre GitHub refuse les protections, les contrôles et les consignes s'appliquent, mais GitHub ne peut pas empêcher techniquement un administrateur de les ignorer : suivre l'issue de protection existante. Ne pas prétendre à une obligation serveur inexistante.

## Vérifier le standard

```sh
node --test .github/scripts/project-workflow.test.mjs
node --check .github/scripts/project-workflow.mjs
```

Les tests couvrent refus des données manquantes, liens fictifs, mauvais projet/champs/statut, blocage, panne Projects, brouillons, clôtures et idempotence. Les tests produit propres au dépôt restent requis; ce standard ne les remplace pas.


Préparation du transfert futur vers Intebec : [procédure et vérifications](github-transfer-intebec.md). Aucun déplacement de dépôt ne doit être déduit de cette documentation seule.
