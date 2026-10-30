# Audit Agentopia — 30 octobre 2026

## Avis général

Agentopia a une vraie utilité : réunir les conversations, les projets et les équipes dans un terminal, tout en permettant de reprendre Codex dans son propre terminal. Les équipes guidées, les branches de travail séparées et la conservation des conversations constituent une bonne base. Le prochain progrès utile est la fiabilité de ces parcours, avant l’ajout de nombreux fournisseurs ou de nouveaux écrans.

L’audit a trouvé des défauts concrets dans les cas d’erreur : une relance pouvait réinitialiser d’autres tâches, une branche écartée pouvait revenir par une dépendance, et une intégration pouvait être déclarée terminée sur la seule parole de l’agent. Des problèmes plus visibles gênaient aussi l’utilisation : pièces jointes impossibles à retirer, perte du brouillon du maître après erreur et saisie hors écran dans un petit terminal.

Le lot de stabilisation corrige ces cas et ajoute des protections de configuration, d’installation et de sélection des projets. Il conserve la disposition habituelle sur un grand terminal. Agentopia reste une bêta : les tests locaux et simulés ne remplacent pas l’utilisation prolongée avec les comptes des différents fournisseurs.

## Méthode et périmètre

Trois agents ont travaillé séparément sur l’expérience utilisateur, le moteur des équipes et la distribution/les données. Une quatrième revue a couvert la résolution des projets, l’import de configuration et l’intégration des changements. Point de départ : commit `48eab7e`, version `1.4.0-beta.8`, branche `codex/sessions-multi-agents`.

Les constats proviennent de la lecture du code, de reproductions avant correction, de profils temporaires, de dépôts Git réels de test et de rendus OpenTUI. Les appels aux modèles sont simulés dans les tests du moteur. Aucun serveur SSH de l’utilisateur n’a été modifié et aucune génération payante n’a été nécessaire pour cet audit.

Les fonctions Git/Docker/SSH/SFTP et les fournisseurs ont été examinés dans leur contexte d’architecture. Cela ne constitue pas un test de chaque opération distante, de chaque compte réel ou de toutes les commandes historiques.

## Défauts prioritaires et correctifs

| Priorité | Constat reproduit | Conséquence | Correction du lot |
|---|---|---|---|
| Haute | Relancer une tâche passe par la réinitialisation globale | D’autres échecs perdent leurs références de session et de branche | Relance ciblée ; refus si un dépendant a déjà démarré, si l’agent reste actif ou si l’intégration a commencé |
| Haute | Écarter A tout en gardant B qui dépend de A | Le code d’A est intégré malgré l’exclusion affichée | Vérification des dépendances transitives ; explication dans Relire ; sélection figée après démarrage de l’intégration |
| Haute | L’intégrateur annonce un succès sans fusionner | Équipe affichée terminée avec fichiers absents | Vérification Git de la destination, de l’état propre et de l’ascendance des branches retenues ; erreur récupérable si la preuve manque |
| Haute | Lecture invalide ou migration non enregistrable des réglages | Retour silencieux aux valeurs par défaut, risque de perte | Stockage dédié, copie du fichier illisible, sauvegarde valide et avis de récupération |
| Haute | Lanceur Windows écrit avant le reçu d’activation | Version lancée différente de la version déclarée | Lanceur stable ; activation par remplacement atomique du reçu ; migration et échecs testés |
| Haute | Deux projets distincts portent le même nom | La première correspondance est utilisée sans choix | Choix explicite avec chemins complets ; dossiers inexistants refusés ; doublons de chemins éliminés |
| Moyenne | Import insuffisamment validé | Réglages partiels, mauvaise correspondance de projet, planifications actives sur le nouveau poste | Validation du document avant écriture ; planifications importées en pause ; projet ambigu ignoré et signalé ; champs SSH contrôlés |
| Moyenne | Pas d’action de retrait des pièces jointes | Envoi accidentel ou impossibilité d’envoyer à Perplexity | Menu au clic et Alt+I ; retrait individuel ou complet ; renumérotation des repères ; fichiers inaccessibles signalés avant l’envoi |
| Moyenne | Échec du maître après effacement du champ | Perte du texte saisi | Restauration du brouillon dans sa destination d’origine ; message explicite |
| Moyenne | Colonnes et indication débordent à 60×18/80×24 | Champ de saisie caché ou chat trop étroit | Conversation pleine largeur sous 100 colonnes ; menu Actions et accès Sessions ; indication sur une ligne ; préférences conservées |
| Moyenne | Diagnostic encore surtout orienté Claude CLI | État des fournisseurs intégrés difficile à comprendre | Diagnostic Codex, Claude et Perplexity, sans génération payante |

## Critique par fonctionnalité

### Conversations et interface

Le champ dans le chat, les brouillons par destination, la recherche et le retour aux derniers messages répondent bien au travail quotidien. La séparation entre actions et messages est utile et doit être conservée. Le mode compact traite la réduction de fenêtre sans imposer une refonte des écrans.

Il reste une densité importante de commandes et de raccourcis. Les menus contextuels et les indications doivent continuer à servir d’entrée principale ; les raccourcis sont un complément. La présence de deux interfaces (OpenTUI actuelle et ancienne interface Ink) augmente le risque de différences de comportement. Les nouveaux correctifs visuels sont validés dans OpenTUI.

Les notices disparaissent après quelques secondes : un historique consultable rendrait les erreurs plus faciles à retrouver. Le collage Windows utilise encore une capture synchrone ; un passage en opération asynchrone éviterait un blocage du rendu si PowerShell répond lentement. Aucun gel prolongé n’a été mesuré durant cet audit.

### Fournisseurs et sessions natives

Les fournisseurs passent par des adaptateurs et partagent un cycle de vie de session, ce qui prépare l’ajout d’autres services. Il faut conserver une présentation honnête de leurs capacités : Codex peut reprendre une conversation dans son terminal, tandis que Perplexity sert à la recherche et n’accepte pas les pièces jointes locales dans ce parcours. Ces capacités ne sont pas interchangeables.

Il ne s’agit pas encore d’un système de plugins : la liste Claude/Codex/Perplexity apparaît aussi dans les types, les sélecteurs et les validations des données persistées. Ajouter un quatrième fournisseur demandera de compléter ces endroits et de tester permissions, annulation et reprise.

Les messages et sorties exposés par les fournisseurs sont disponibles en direct. Cela ne donne pas accès à toute leur activité interne, et l’absence d’événement ne signifie pas forcément que l’agent est arrêté. Le coût affiché dépend des données réellement fournies ; une valeur absente ne doit pas devenir un coût nul présenté comme certain.

### Équipes et intégration Git

Les worktrees, les dépendances, les permissions et les reprises dans la même conversation constituent le cœur différenciant du produit. Les protections ajoutées rendent le statut de fin plus fiable.

La preuve de fusion Git ne prouve pas la qualité du code ni la réussite des tests annoncés par un agent. Un prochain chantier utile serait un résultat de vérification structuré, avec la commande réellement lancée, son code de sortie et son journal, visible dans Relire. Les dépendances implicites, par exemple du code recopié entre agents hors du graphe déclaré, restent difficiles à suivre.

La collaboration actuelle orchestre des tâches et leurs dépendances, avec transmission des résultats et branches. Ce n’est pas encore un salon où tous les agents débattent continuellement. Les anciennes intégrations natives sans branche de destination enregistrée demandent une vérification manuelle ; leurs fichiers sont conservés.

### Projets, Git, Docker, SSH et SFTP

Le regroupement de ces outils réduit les changements de fenêtre. Il augmente aussi l’importance du contexte : le dossier et la cible doivent être visibles avant d’agir. Le correctif des projets homonymes traite un risque concret, et le contrôle des champs SSH empêche qu’un import ajoute des directives cachées par retour à la ligne.

Les opérations distantes, les transferts interrompus et les serveurs injoignables nécessitent encore une campagne de tests dédiée avec des services locaux jetables. Cet audit n’affirme pas que tous ces parcours ont été testés sur les serveurs de l’utilisateur.

### Planifications, configuration et récupération

Le moteur indépendant de la fenêtre et les sauvegardes d’équipes sont de bonnes fondations. Importer des planifications en pause rend le changement de poste compréhensible et évite un démarrage inattendu.

Les garanties de récupération ne sont pas uniformes entre équipes, réglages et métadonnées des sessions. La configuration bénéficie maintenant d’un stockage distinct ; la même approche doit être évaluée pour les autres fichiers sensibles. L’import est validé avant application, mais la configuration et le fichier SSH restent deux écritures distinctes : une panne de disque entre les deux peut encore exiger de reprendre l’import.

Le parcours de préparation mémorise les projets ignorés et les fournisseurs reportés. Une nouvelle analyse ne remet pas automatiquement tous ces choix à zéro : une action explicite pour revoir les choix différés serait utile. Les anciennes versions et archives de téléchargement peuvent aussi s’accumuler ; leur rangement devrait afficher l’espace récupérable tout en conservant le retour arrière.

### Installation et diffusion

Le Setup avec progression, les runtimes inclus, la vérification SHA-256, la réparation et le retour arrière simplifient beaucoup l’installation. La cohérence entre lanceur et activation est désormais traitée explicitement.

Le binaire reste non signé. Le travail de stabilisation ne supprime pas l’avertissement SmartScreen. La signature d’éditeur et la validation sur plusieurs machines Windows doivent rester dans le plan de diffusion. La branche de développement contient les fonctions Agentopia ; le README principal doit continuer à indiquer clairement où sont les sources tant que leur fusion n’est pas effectuée.

### Structure du code et tests

Des responsabilités sont déjà séparées : fournisseurs, workers, permissions, horloge de travail, stockage des équipes et distribution. Ce lot poursuit cette séparation avec `validationEquipe`, `stockageConfig`, `importConfiguration` et `piecesJointes`.

`commandes.ts`, `equipe.ts` et les contrôleurs d’interface restent volumineux et mêlent plusieurs responsabilités. Une migration progressive des commandes vers des services métier typés est préférable à une réécriture massive pendant la stabilisation. Une règle de transition devrait être partagée par le moteur et les interfaces, puis testée par son effet observable.

## Validation

Les nouveaux tests couvrent les défauts reproduits, pas seulement des fonctions auxiliaires : choix réel avant exécution d’une commande, document d’import invalide sans écriture, dépendances Git, faux succès d’intégration, panne de sauvegarde, activation Windows et interactions clavier/souris dans le rendu terminal.

Après regroupement des corrections, `npm run test:ci` réussit : **137 tests Node, 8 scénarios OpenTUI, compilation TypeScript du cœur et de l’interface**. Les nouveaux cas incluent 60×18 et 80×24 puis le retour aux préférences à 140 colonnes. Les tests d’activation exécutent réellement CMD dans des chemins contenant espaces, parenthèses, `!` et `&`. Une première variante de validation du reçu refusait un cas valide ; ce défaut détecté par la suite a été corrigé avant construction du paquet.

La publication Windows exige en plus la construction et les tests du vrai Setup sur le runner GitHub : installation, mise à jour, réparation, retour arrière, conservation des données et erreurs de téléchargement. Les tests réels Claude/Perplexity et les opérations distantes restent hors de cette validation automatisée.

## Suite recommandée

**Avancement en bêta 11 :** un parcours de vérification explicite depuis Relire, un historique des avis, le collage asynchrone et la révision des choix reportés ont été ajoutés. [Fonctionnement et limites](verifier-un-resultat.md). La récupération des métadonnées de sessions, les comptes réels Claude/Perplexity, les opérations distantes et la signature Windows restent des chantiers distincts.

1. Utiliser cette version sur des projets réels, en notant les erreurs de reprise, de permission et d’affichage ; corriger les régressions avant d’augmenter le périmètre.
2. Ajouter aux bilans d’équipe une preuve des vérifications réellement exécutées, avec un statut distinct pour « non vérifié ».
3. Uniformiser la récupération des métadonnées de sessions et tester les coupures pendant les écritures.
4. Valider Claude et Perplexity avec leurs comptes réels, puis créer des scénarios jetables pour SSH/SFTP/Docker.
5. Extraire progressivement les commandes métier des contrôleurs d’interface ; préparer la signature Windows et la fusion de la branche avant une version stable.

Ajouter un fournisseur supplémentaire viendra ensuite, avec un contrat de capacités, des tests d’annulation/reprise et une présentation claire de ses limites.
