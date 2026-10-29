# Installation d'Agentopia sur un poste Windows : installe ce qui manque, compile, crée le raccourci,
# puis lance Agentopia qui scanne le poste (projets, serveurs SSH, outils).
# Trois façons de lancer :
#   - double-clic sur Installer.bat dans le dossier ;
#   - en une ligne (dépôt privé, avec ton accès git) :
#       git clone <url du depot> "$HOME\Agentopia"; & "$HOME\Agentopia\Installer.bat"
#   - en une ligne depuis le fichier brut (dépôt public) :
#       irm <url brute de install.ps1> | iex
#     Dans ce cas, le script récupère lui-même le code dans ~\Agentopia (ou le met à jour), et installe Git au besoin.
# Les programmes manquants s'installent avec winget (présent sur Windows 10 et 11 à jour).
# Compatible Windows PowerShell 5.1 (présent sur tous les postes).

# Les erreurs sont gérées à la main (codes de retour) : un simple avertissement de npm ne doit pas tout arrêter
$ErrorActionPreference = 'Continue'

# Adresse du dépôt, utilisée quand le script est lancé seul (irm | iex). /installation dans Agentopia affiche la bonne ligne.
$Depot = if ($env:CLAUDETOPIA_DEPOT) { $env:CLAUDETOPIA_DEPOT } else { 'https://github.com/SamChampagne/ClaudeTopia.git' }
$Dossier = Join-Path $HOME 'Agentopia'
# Reprendre une installation existante sans créer une deuxième copie du projet.
$AncienDossier = Join-Path $HOME 'Claudetopia'
if (-not (Test-Path -LiteralPath $Dossier) -and (Test-Path -LiteralPath (Join-Path $AncienDossier '.git'))) { $Dossier = $AncienDossier }
$problemes = @()

function Titre($texte) { Write-Host ""; Write-Host "== $texte ==" -ForegroundColor Cyan }
function Ok($texte) { Write-Host "  [OK] $texte" -ForegroundColor Green }
function Avert($texte, $solution) {
    Write-Host "  [!]  $texte" -ForegroundColor Yellow
    if ($solution) { Write-Host "       -> $solution" -ForegroundColor DarkYellow }
}
function Erreur($texte, $solution) {
    Write-Host "  [X]  $texte" -ForegroundColor Red
    if ($solution) { Write-Host "       -> $solution" -ForegroundColor Red }
    $script:problemes += $texte
}
function Present($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Arreter($message) {
    Write-Host ""
    Write-Host "Installation interrompue : $message" -ForegroundColor Red
    Write-Host "Corrige le point ci-dessus puis relance l'installation." -ForegroundColor Red
    Read-Host "Appuie sur Entree pour fermer"
    # exit fermerait la fenetre PowerShell quand le script est lance par irm | iex
    if ($MyInvocation.ScriptName) { exit 1 } else { throw 'installation interrompue' }
}
# Un programme installé à l'instant n'est pas encore dans le PATH de cette fenêtre : on le relit
function RelirePath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
# Installe un programme avec winget s'il manque ; rend vrai si la commande est là ensuite
function Installer($cmd, $id, $nom) {
    if (Present $cmd) { return $true }
    if (-not (Present 'winget')) { return $false }
    Write-Host "  ...  Installation de $nom" -ForegroundColor Gray
    winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent | Out-Host
    RelirePath
    return (Present $cmd)
}

$racine = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $null }
if (-not $racine -or -not (Test-Path (Join-Path $racine 'package.json'))) {
    Write-Host "Recuperation de Agentopia dans $Dossier" -ForegroundColor Magenta
    if (-not (Installer 'git' 'Git.Git' 'Git')) {
        Write-Host "  [X]  Git est introuvable -> winget install Git.Git   (puis ferme et rouvre la fenetre)" -ForegroundColor Red
        return
    }
    if (Test-Path (Join-Path $Dossier '.git')) {
        git -C $Dossier pull --ff-only
    } elseif ($Depot) {
        git clone $Depot $Dossier
    } else {
        Write-Host "  [X]  Adresse du depot inconnue : definis-la puis relance, par exemple" -ForegroundColor Red
        Write-Host "       `$env:CLAUDETOPIA_DEPOT = 'https://github.com/<compte>/claudetopia.git'" -ForegroundColor Red
        return
    }
    if (-not (Test-Path (Join-Path $Dossier 'package.json'))) {
        Write-Host "  [X]  La recuperation du code a echoue (voir le message de git ci-dessus)" -ForegroundColor Red
        return
    }
    $racine = $Dossier
}
Set-Location $racine

Write-Host "Installation de Agentopia" -ForegroundColor Magenta
Write-Host "Dossier : $racine"
if (-not (Present 'winget')) {
    Avert "winget est introuvable : les programmes manquants ne pourront pas s'installer tout seuls" "installe « App Installer » depuis le Microsoft Store, puis relance"
}

# --- 1. Prérequis obligatoires (installés s'ils manquent) ---
Titre "Prerequis"
if (-not (Installer 'node' 'OpenJS.NodeJS.LTS' 'Node.js')) {
    Erreur "Node.js est introuvable" "winget install OpenJS.NodeJS.LTS   (puis ferme et rouvre cette fenetre)"
    Arreter "Node.js manquant"
}
$versionNode = (node --version).TrimStart('v')
$majeure = [int]($versionNode.Split('.')[0])
if ($majeure -lt 18 -and (Present 'winget')) {
    Write-Host "  ...  Mise a jour de Node.js $versionNode" -ForegroundColor Gray
    winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent | Out-Host
    RelirePath
    $versionNode = (node --version).TrimStart('v')
    $majeure = [int]($versionNode.Split('.')[0])
}
if ($majeure -lt 18) {
    Erreur "Node.js $versionNode est trop ancien (18 minimum)" "winget upgrade OpenJS.NodeJS.LTS   (puis ferme et rouvre cette fenetre)"
    Arreter "Node.js trop ancien"
}
Ok "Node.js $versionNode"
if (-not (Present 'npm')) { Erreur "npm est introuvable (normalement installe avec Node.js)" "reinstalle Node.js : winget install OpenJS.NodeJS.LTS"; Arreter "npm manquant" }
Ok "npm $(npm --version)"

# --- 2. Outils (installés s'ils manquent ; Agentopia marche sans, mais certaines fonctions seront grisées) ---
Titre "Outils"
if (Installer 'git' 'Git.Git' 'Git') { Ok "Git" } else { Avert "Git absent : statut des projets, commits et journal indisponibles" "winget install Git.Git" }
if (Installer 'wt' 'Microsoft.WindowsTerminal' 'Windows Terminal') { Ok "Windows Terminal" } else { Avert "Windows Terminal absent : la souris et les onglets ne marcheront pas" "winget install Microsoft.WindowsTerminal" }
if (Installer 'rg' 'BurntSushi.ripgrep.MSVC' 'ripgrep') { Ok "ripgrep" } else { Avert "ripgrep absent : /cherche indisponible" "winget install BurntSushi.ripgrep.MSVC" }
# Les fournisseurs sont choisis et préparés dans l’application.
# Lourds et pas indispensables : seulement signalés
if (Present 'code') { Ok "VS Code" } else { Avert "VS Code absent : les boutons VS Code ne feront rien (optionnel)" "winget install Microsoft.VisualStudioCode" }
if (Present 'docker') { Ok "Docker" } else { Avert "Docker absent : la section Docker restera vide (optionnel)" $null }

# --- 3. Dépendances et compilation ---
Titre "Dependances"
try {
    if (Test-Path (Join-Path $racine 'package-lock.json')) { npm ci --no-audit --no-fund } else { npm install --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { throw "code $LASTEXITCODE" }
    Ok "Dependances installees"
} catch {
    Erreur "Echec de l'installation des dependances ($_)" "verifie ta connexion Internet (ou le proxy npm : npm config get proxy)"
    Arreter "dependances"
}

Titre "Compilation"
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "code $LASTEXITCODE" }
    Ok "Compilation terminee"
} catch {
    Erreur "La compilation a echoue ($_)" "lis le message d'erreur ci-dessus"
    Arreter "compilation"
}

# --- 3 bis. Nouvelle interface (OpenTUI, sous Bun) ; sans elle, l'ancienne interface est utilisée ---
Titre "Nouvelle interface"
try {
    if (-not (Installer 'bun' 'Oven-sh.Bun' 'Bun')) { throw "Bun introuvable apres installation" }
    Push-Location (Join-Path $racine 'tui')
    try { bun install } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "code $LASTEXITCODE" }
    Ok "Bun $(bun --version) et la nouvelle interface"
} catch {
    Avert "Nouvelle interface indisponible ($_) : Agentopia utilisera l'ancienne" "winget install Oven-sh.Bun   puis relance l'installation"
}

# --- 4. Node 24 pour la souris (sans toucher au Node du système) ---
Titre "Souris"
if ($majeure -ge 24) {
    Ok "Node $versionNode gere deja la souris"
} else {
    try {
        $v24 = (npx -y node@24 --version | Select-Object -Last 1)
        if (-not $v24) { throw "pas de version" }
        Ok "Node $v24 telecharge pour Agentopia (le Node du systeme ne change pas)"
    } catch {
        Avert "Impossible de preparer Node 24 : Agentopia marchera, mais sans la souris" "verifie ta connexion Internet puis relance l'installation"
    }
}

# --- 5. Raccourci sur le bureau ---
Titre "Raccourci"
try {
    $bureau = [Environment]::GetFolderPath('Desktop')
    $lien = Join-Path $bureau 'Agentopia.lnk'
    $lanceur = Join-Path $racine 'Agentopia.bat'
    # Ancien nom du logiciel
    Remove-Item (Join-Path $bureau 'CLI Perso.lnk') -ErrorAction SilentlyContinue
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lien)
    $wt = Get-Command wt -ErrorAction SilentlyContinue
    if ($wt) {
        $s.TargetPath = $wt.Source
        $s.Arguments = "-d `"$racine`" --title `"Agentopia`" cmd /k `"$lanceur`""
        $s.IconLocation = "$($wt.Source),0"
    } else {
        $s.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $s.Arguments = "/k `"$lanceur`""
    }
    $s.WorkingDirectory = $racine
    $s.Description = 'Agentopia : sessions et equipes multi-agents, projets, Git, Docker, SSH'
    $s.Save()
    Ok "Raccourci Agentopia cree sur le bureau"
} catch {
    Avert "Impossible de creer le raccourci ($_)" "lance plutot Agentopia.bat, ou /raccourci depuis Agentopia"
}

# --- Résumé, puis Agentopia qui scanne le poste ---
Titre "Termine"
if ($problemes.Count -eq 0) {
    Write-Host "  Agentopia est installe. La preparation des agents continue dans l’application." -ForegroundColor Green
} else {
    Write-Host "  Installe, mais $($problemes.Count) point(s) a corriger (voir ci-dessus)." -ForegroundColor Yellow
}
Write-Host "  Agentopia s'ouvre et scanne le poste : projets, serveurs SSH et outils." -ForegroundColor Gray
Write-Host "  Ensuite : /diagnostic verifie tout, /config regle comptes et interface, /maj met a jour." -ForegroundColor Gray
# CLAUDETOPIA_SCAN : Agentopia lance /scan au démarrage (le premier lancement passe par /bienvenue, qui le propose)
$commande = "set CLAUDETOPIA_SCAN=1&& `"$(Join-Path $racine 'Agentopia.bat')`""
if (Present 'wt') { Start-Process wt -ArgumentList "-d `"$racine`" --title `"Agentopia`" cmd /k `"$commande`"" }
else { Start-Process cmd -ArgumentList "/k `"$commande`"" }
