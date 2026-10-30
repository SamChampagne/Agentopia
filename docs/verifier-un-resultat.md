# Vérifier un résultat et retrouver les messages utiles

## Lancer une vérification depuis une équipe

Dans **Équipes → Relire (b)**, choisis **Vérifier le projet · scripts existants**. Agentopia propose le dossier du projet et les dossiers de travail disponibles des tâches terminées ou arrêtées. Attends l’arrêt effectif des agents avant de vérifier leur travail.

Le parcours lit les scripts réellement présents dans `package.json` : tests, vérification de types et lint, avec leurs variantes utilisables sans interaction. Il reconnaît npm, pnpm, yarn et Bun à partir du gestionnaire déclaré ou des fichiers lock. Si plusieurs gestionnaires sont possibles, il demande de clarifier le projet ; il ne choisit pas silencieusement.

Avant le lancement, tu vois le dossier, la commande et le contenu du script, ainsi que ses éventuelles étapes `pre` et `post`. Tu confirmes une seule commande à la fois. Agentopia utilise le gestionnaire déjà installé, sans préparer les dépendances ni demander une réponse à un agent. Les scripts et la configuration du gestionnaire peuvent néanmoins déclencher leurs propres téléchargements, par exemple un changement de version de pnpm. Lis le contenu du script avant de confirmer.

La sortie s’affiche pendant l’exécution. Tu peux annuler ; tant qu’Agentopia tourne, il demande l’arrêt après cinq minutes ou 512 Ko de journal. Un arrêt sur limite est présenté comme une interruption. Les scripts de surveillance continue et les modes clairement interactifs ne sont pas proposés.

Si Windows refuse l’arrêt, Agentopia rend la main et indique **arrêt non confirmé** : la commande peut encore tourner. Un nouveau lancement dans ce dossier reste bloqué. Vérifie et arrête les processus concernés avant de retirer le marqueur dont le chemin est donné dans le message. Fermer normalement Agentopia tente aussi d’arrêter sa vérification ; un plantage brutal peut laisser des processus actifs, même si le lanceur a disparu. Une exécution sans fin confirmée bloque également la relance et reste en cours ou inconnue. Il n’y a pas encore de surveillance indépendante capable d’imposer les cinq minutes après ce plantage.

## Lire le résultat

**Journaux des vérifications** permet de retrouver la commande, le dossier, les dates, le code de sortie et le texte produit. Ces résultats sont enregistrés dans le profil Agentopia, séparément des résumés des agents et du dépôt vérifié.

| État | Signification |
|---|---|
| Non vérifié | Aucune exécution enregistrée pour cette cible. |
| En cours | La vérification est encore active. |
| Réussi | La commande a terminé avec un code de sortie nul et l’état du projet correspond à celui vérifié. |
| Échoué | La commande a renvoyé un échec ou n’a pas pu démarrer. |
| Interrompu | Annulation, limite atteinte ou exécution interrompue. |
| Périmé | Le contenu du projet a changé depuis la vérification, ou pendant celle-ci. Relance-la sur le nouvel état. |
| Inconnu | La fin de l’exécution n’est pas confirmée ou Agentopia ne peut pas établir une empreinte fiable du projet ; le journal et le code de sortie disponibles restent consultables. |

L’empreinte tient compte du contenu des fichiers suivis et non ignorés, pas seulement du nom des fichiers modifiés. Sa lecture est bornée ; les projets trop volumineux, les sous-modules ou les fichiers inaccessibles peuvent produire un état inconnu. Les dépendances et autres fichiers ignorés par Git ne sont pas couverts par cette empreinte.

Un code de sortie nul signifie que **cette commande** a réussi. Cela ne prouve pas que tous les tests nécessaires existent, que l’agent a tout vérifié, ni que le logiciel répond à tous les besoins. L’intégration des branches reste une action distincte avec sa propre vérification Git. Cette première version du parcours cible les scripts JavaScript/TypeScript ; elle ne devine pas de commande pour les autres projets.

## Retrouver un avertissement

Clique **Avis** près de la saisie, utilise **Alt+N** ou la commande **`/avis`**. La vue conserve les 100 derniers avis et erreurs de ce lancement, avec leur heure. Les répétitions rapprochées sont regroupées.

Choisis un message avec les flèches, puis Entrée pour lire le texte complet. Le détail défile et peut être copié. Échap revient à la liste, puis à la conversation avec son brouillon. Cet historique reste en mémoire et disparaît quand l’app ferme.

**Alt+V** ajoute toujours une image du presse-papiers. La capture se fait désormais sans bloquer la saisie : tu peux continuer à écrire ou changer de conversation. L’image rejoint le brouillon de la conversation où tu as commencé le collage. Une erreur conserve ton texte et reste consultable dans les avis.

## Revoir les choix de préparation

Dans **Config → Préparer le poste**, une préparation déjà terminée propose de garder les choix, vérifier les agents choisis ou revoir les choix reportés.

- **`/preparer projets`** repropose les projets ignorés, sans retirer ceux que tu suis déjà.
- **`/preparer agents`** permet de reprendre les agents reportés.
- **`/choisir-agents`** permet d’ajouter ou changer la sélection ; annuler conserve les choix précédents.
- **`/scan [filtre]`** recherche de nouveaux projets et peut aussi revoir les projets ignorés. Il affiche un bilan et ne prépare pas les fournisseurs.

Le premier lancement conserve son parcours direct. Reprendre un choix ne supprime ni les conversations ni les connexions existantes. L’installation de Codex, si nécessaire, est confirmée avant de commencer.
