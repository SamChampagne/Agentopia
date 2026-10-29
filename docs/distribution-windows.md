# Distribution Windows

## Utilisation

Ouvrir **Agentopia-Setup.exe**. L’installation se fait dans `%LOCALAPPDATA%\Programs\Agentopia`, avec un raccourci Agentopia. Node 24 et Bun sont inclus. La préparation des projets et fournisseurs s’ouvre ensuite dans l’interface existante.

L’archive **Agentopia-Windows-x64.zip** peut aussi être extraite et lancée avec `Agentopia.cmd`. Le mode portable n’a pas le gestionnaire de versions installé ; utiliser Setup pour la maintenance intégrée.

Les réglages, secrets chiffrés et conversations restent dans les chemins utilisateur historiques `.claudetopia*`. Le téléchargement ne les contient pas. L’installation ne modifie pas Node/Bun système et ne nécessite pas de compilation sur le poste destinataire. Les outils optionnels (Git, Codex, Claude CLI) et leurs comptes restent distincts ; la connexion nécessite Internet et une action de l’utilisateur.

## Maintenance

- `/version` indique l’identifiant exact et le dossier de la version exécutée.
- `/maj` lit la dernière Release GitHub compatible, demande l’installation et vérifie le SHA-256 du téléchargement. Une Release sans paquet compatible ne remplace rien.
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

## Vérifier sans toucher au profil réel

```powershell
node test-installation-windows.mjs releases/<identifiant>
```

Le test installe dans un dossier temporaire avec espaces, sans raccourci ni lancement interactif. Il exécute l’interface de test avec les runtimes inclus et un PATH restreint, vérifie une réparation hors ligne, le retour à la version précédente et le refus d’un fichier altéré. Aucun fournisseur n’est appelé. Cela constitue une validation isolée sur le poste de développement, pas un test dans une VM Windows vierge ni une validation SmartScreen/antivirus.
