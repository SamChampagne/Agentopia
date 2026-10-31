# Consignes de développement — Agentopia

## Suivi GitHub obligatoire

Avant tout changement, appliquer [le workflow complet](docs/github-workflow.md) : issue avec description, critères, estimation en heures, hypothèses, validation prévue et priorité; carte dans le projet; `node .github/scripts/project-workflow.mjs start NUMERO`; branche isolée; PR avec `Closes #N`, Validation et Limites; statut In Review; contrôles verts; clôture et Done vérifiés. Mettre à jour estimation et statut pendant le travail. Un blocage se décrit et se marque avec la commande block. Ne jamais prétendre avoir créé, estimé, relié ou clôturé un suivi sans le vérifier sur GitHub. Les règles métier ci-dessous restent obligatoires.

Lire et suivre [CONTRIBUTING.md](CONTRIBUTING.md) et [docs/etat-du-projet.md](docs/etat-du-projet.md) avant un changement.

Chaque changement demandé suit une issue liée au [projet GitHub](https://github.com/users/SamChampagne/projects/4), une branche isolée, une PR avec `Closes #N`, les validations réellement exécutées, puis la fusion autorisée et la clôture vérifiée. Mettre le statut du projet à jour. Conserver les fichiers locaux, les branches divergentes et les instructions métier existantes. Si un accès manque, ne pas prétendre avoir publié ou validé.

Préserver profils, sessions, secrets et processus personnels. Les essais utilisent des profils temporaires. Les contrats de permission, reprise, isolation des worktrees et distribution Windows ne doivent pas être contournés. Le README et la version doivent décrire le code effectivement publié.


Préparation du transfert futur vers Intebec : [procédure et vérifications](docs/github-transfer-intebec.md). Aucun déplacement de dépôt ne doit être déduit de cette documentation seule.
