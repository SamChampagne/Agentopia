# Distribution Windows

## Utilisation

Ouvrir **Agentopia-Setup.exe**. L’installation se fait dans `%LOCALAPPDATA%\Programs\Agentopia`, avec un raccourci Agentopia. Node 24 et Bun sont inclus. La préparation des projets et fournisseurs s’ouvre ensuite dans l’interface existante.

L’archive **Agentopia-Windows-x64.zip** peut aussi être extraite et lancée avec `Agentopia.cmd`. Le mode portable n’a pas le gestionnaire de versions installé ; utiliser Setup pour la maintenance intégrée.

Les réglages, secrets chiffrés et conversations restent dans les chemins utilisateur historiques `.claudetopia*`. Le téléchargement ne les contient pas. L’installation ne modifie pas Node/Bun système et ne nécessite pas de compilation sur le poste destinataire. Les outils optionnels (Git, Codex, Claude CLI) et leurs comptes restent distincts ; la connexion nécessite Internet et une action de l’utilisateur.

## Maintenance

- `/version` indique l’identifiant exact et le dossier de la version exécutée.
- `/maj` cherche une version Windows supérieure, demande l’installation et vérifie le SHA-256 du téléchargement. Le canal bêta accepte les bêtas suivantes et les versions stables supérieures ; le canal stable exclut les préversions. Une Release sans paquet compatible ne remplace rien.
- `/reparer` extrait le paquet conservé localement, contrôle les fichiers et le démarrage de l’interface, puis active une nouvelle copie. Les données utilisateur sont conservées.
- `/retour-version` vérifie et réactive la version précédente. Fermer puis relancer Agentopia après ces opérations.

Chaque version reste dans son propre répertoire. Un verrou empêche deux installations simultanées. Les chemins du ZIP et les fichiers attendus sont contrôlés avant activation. Les sommes de contrôle détectent une corruption ; elles ne remplacent pas une signature Authenticode. L’exécutable de développement n’est pas signé.

## Construire

Depuis un checkout Windows x64 avec les dépendances installées :

```powershell
npm run test:ci
# Nécessaire seulement si le Node du développeur est antérieur à 24 :
$env:AGENTOPIA_BUILD_NODE='C:\chemin\node24\node.exe'
npm run package:windows
```

La construction compile le code, vérifie les types TUI, copie uniquement les composants autorisés et installe les dépendances TUI avec le lockfile dans un dossier neuf. Elle utilise Bun installé pour compiler l’installeur et embarque sa licence et celle de la version de Node choisie. Les licences disponibles sont dans `vendor/runtime-licenses`; une autre version est téléchargée depuis le dépôt officiel correspondant.

Résultats dans `releases/<identifiant>/` : `Agentopia-Setup.exe`, `Agentopia-Windows-x64.zip`, `agentopia-release.json`, `SHA256SUMS.txt` et le dossier portable. Pour rendre `/maj` utilisable publiquement, publier ces quatre fichiers dans une Release du dépôt `SamChampagne/ClaudeTopia`. Aucune publication automatique n’est effectuée par la construction.

Le tag local `agentopia-1.0.0-baseline` conserve le point de départ avant le moteur indépendant et les missions de la version 1.1. La validation CI est définie dans `.github/workflows/validation.yml` ; elle s’exécutera sur GitHub après envoi de la branche. Le paquet embarque le moteur et ses workers dans `dist/`. Aucun service système n’est installé et aucune tâche planifiée n’est créée par l’installeur.

La version 1.2 ajoute les équipes guidées, les modèles réutilisables, le bilan commun et la reprise dans la même branche. Fermer les anciennes fenêtres puis relancer Agentopia après installation. Le moteur précédent est remplacé au repos ; s’il travaille encore, laisser finir ou utiliser la pause globale avant de reprendre le moteur depuis Config. Les modèles restent dans le profil utilisateur lors d’une réparation ou d’un retour de version.

La version 1.3 ajoute l’édition des plans avant lancement, la reprise des intégrations et les protections contre les intégrations concurrentes. Les tests de régression créent un conflit Git réel dans un dépôt temporaire et utilisent des fournisseurs simulés. Les dialogues sont aussi vérifiés avec des frappes rapprochées. La procédure de mise à jour et les données utilisateur restent identiques.

## Vérifier sans toucher au profil réel

La version 1.3.1 ajoute la récupération après plantage et les sauvegardes des équipes. Les régressions couvrent un worker réellement arrêté de force, le démarrage concurrent d’un même tour, un fichier d’équipes invalide et la restauration depuis le moteur et l’interface. Les fournisseurs de ces tests restent simulés.

```powershell
node test-installation-windows.mjs releases/<identifiant>
```

Le test installe dans un dossier temporaire avec espaces, sans raccourci ni lancement interactif. Il exécute l’interface avec les runtimes inclus et un PATH restreint. Il passe ensuite par le gestionnaire de mise à jour de l’app (réponses HTTP simulées, véritable ZIP et installation), puis vérifie réparation hors ligne, retour arrière et refus d’un fichier altéré. Aucun fournisseur n’est appelé. Le workflow GitHub exécute ces contrôles sur un runner Windows distinct avant de publier un tag bêta. Ce contrôle ne constitue pas une validation SmartScreen/antivirus.

Pour publier : pousser un tag `agentopia-<version>-beta.<numéro>` correspondant à la version du package. Le job Windows compile et teste le Setup ; le job de publication crée ensuite la préversion avec ses quatre fichiers (Setup, ZIP, manifeste, SHA256). Un échec de validation empêche la publication. `workflow_dispatch` permet aussi de valider un paquet sans publier.

La gestion du tour est séparée en `sessionWorker` (cycle de vie), `horlogeTravail` (budget actif), `demandesPermission` (file de réponses), `presentationPermission` (texte), `finEquipe` (parcours final) et `versionsDistribution` (sélection et validation des mises à jour). Ces responsabilités peuvent évoluer indépendamment des adaptateurs fournisseurs.
