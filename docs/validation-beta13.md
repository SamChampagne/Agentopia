# Validation locale — 1.4.0-beta.13

## Parcours UX vérifiés sur des profils temporaires

- `node --test test-ux-avancee.mjs` : 9 cas réussis. Contexte du shell et des nouvelles sessions, publication du catalogue projets, préparation sans agent, recherche au-delà de 2 Mio et 6 000 messages, pagination sans trou, export Markdown/JSONL, événements trop grands refusés explicitement, recherche dans les archives avec annulation, coûts inconnus distincts de zéro et création réelle d’un worktree sur un dépôt Git local. Aucun modèle ni dépôt distant utilisé.
- `node test-composeur-ink.mjs` : collage multiligne et indentation conservés, ajout d’une ligne par Ctrl+J et envoi explicite.
- `bun tui/test-ux-avancee.tsx` : composeur dans le chat, changement de brouillon, frappe rapide, Ctrl+J, shell dans le dossier de la conversation, recherche ancienne, pages antérieures, catalogue actualisé sans remonter la vue et sélection visible à 60, 80 et 130 colonnes.
- Régressions isolées réussies : `test-qualite-vie.tsx`, `test-conversation-live.tsx`, `test-avis-collage.tsx`, `test-audit-experience.tsx` et `test-edition-equipe.tsx`. Ce dernier choisit maintenant les actions par leur libellé et effectue toujours la navigation réelle au clavier.

La recherche globale parcourt les conversations intégrées, y compris archivées, et les conversations Claude CLI déjà indexées des projets suivis. Une conversation Codex externe doit d’abord être importée explicitement. Le lecteur affiche une erreur pour un événement supérieur à 8 Mio ; l’export JSONL permet de conserver le fichier original. L’export Markdown représente le journal d’événements, y compris les mises à jour successives des outils.

## Incident de validation : ancien smoke non isolé

Le smoke historique `tui/test-interface.tsx` a été lancé avant vérification de son préambule. Il utilisait le profil personnel et la collecte du poste. Il a été interrompu et **n’est pas une preuve de validation** de cette version. Le parcours avait ouvert puis annulé des vues ; il avait aussi commencé `/sftp dev`, sans validation d’empreinte ni opération sur un fichier distant.

Les effets identifiés sont limités mais réels :

- La normalisation des réglages a ajouté uniquement `equipe.paralleleGlobal: 3`. La version précédente de la configuration a été conservée par le stockage habituel. Ce réglage est resté en place.
- Quinze commandes du smoke formaient un suffixe exact de 120 octets dans l’historique. Ce suffixe a été retiré après vérification de l’absence de modification concurrente, par remplacement atomique. Les 31 octets préexistants ont été conservés et vérifiés byte à byte, sans afficher leur contenu.
- Le brouillon général du contexte `commande:<dépôt>/tui` a été sauvegardé vide dans `~/.claudetopia-brouillons/8c71c8f62345ce68591f6820691bc0742e96485cce6da363721253066009dbe4.json`. Le stockage ne garde pas de version précédente de ce brouillon. Son état avant ce lancement ne peut donc pas être certifié ; aucune restauration supposée n’a été effectuée. Les brouillons des conversations n’ont pas été ciblés par le parcours.

Aucune nouvelle session intégrée ni aucun nouveau reçu d’utilisation IA n’ont été observés dans les métadonnées contrôlées ; aucun appel à un modèle n’est prévu dans le parcours exécuté. Cela ne constitue pas une affirmation de « zéro écriture sur le poste » : la collecte et les écritures de profil ci-dessus ont bien eu lieu.

Le smoke refuse désormais de démarrer avant tout import de l’application si `CLAUDETOPIA_TEST_UI=1` et un `CLAUDETOPIA_DATA_DIR` dans un dossier temporaire dédié ne sont pas présents. Le moteur et la collecte sont désactivés ; l’étape ciblant le serveur réel a été retirée. Le refus sans profil temporaire a été vérifié. Les preuves retenues restent les tests à fixtures isolées.

## Vérification commune

Les résultats de compilation, de la chaîne CI et de la distribution Windows sont consignés séparément par la validation commune du lot ; les tests ci-dessus ne prouvent pas une exécution réelle de tous les fournisseurs payants.
