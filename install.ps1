# Installation de Claudetopia sur un poste Windows.
# Trois façons de lancer :
#   - double-clic sur Installer.bat dans le dossier ;
#   - en une ligne (dépôt privé, avec ton accès git) :
#       git clone <url du depot> "$HOME\Claudetopia"; & "$HOME\Claudetopia\Installer.bat"
#   - en une ligne depuis le fichier brut (dépôt public) :
#       irm <url brute de install.ps1> | iex
#     Dans ce cas, le script récupère lui-même le code dans ~\Claudetopia (ou le met à jour).
# Compatible Windows PowerShell 5.1 (présent sur tous les postes).

# Les erreurs sont gérées à la main (codes de retour) : un simple avertissement de npm ne doit pas tout arrêter
$ErrorActionPreference = 'Continue'

# Adresse du dépôt, utilisée quand le script est lancé seul (irm | iex). /installation dans Claudetopia affiche la bonne ligne.
$Depot = if ($env:CLAUDETOPIA_DEPOT) { $env:CLAUDETOPIA_DEPOT } else { 'https://github.com/SamChampagne/ClaudeTopia.git' }
$Dossier = Join-Path $HOME 'Claudetopia'

$racine = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { $null }
if (-not $racine -or -not (Test-Path (Join-Path $racine 'package.json'))) {
    Write-Host "Recuperation de Claudetopia dans $Dossier" -ForegroundColor Magenta
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
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

Write-Host "Installation de Claudetopia" -ForegroundColor Magenta
Write-Host "Dossier : $racine"

# --- 1. Prérequis obligatoires ---
Titre "Prerequis"
if (-not (Present 'node')) {
    Erreur "Node.js est introuvable" "winget install OpenJS.NodeJS.LTS   (puis ferme et rouvre cette fenetre)"
    Arreter "Node.js manquant"
}
$versionNode = (node --version).TrimStart('v')
$majeure = [int]($versionNode.Split('.')[0])
if ($majeure -lt 18) {
    Erreur "Node.js $versionNode est trop ancien (18 minimum)" "winget upgrade OpenJS.NodeJS.LTS"
    Arreter "Node.js trop ancien"
}
Ok "Node.js $versionNode"
if (-not (Present 'npm')) { Erreur "npm est introuvable (normalement installe avec Node.js)" "reinstalle Node.js : winget install OpenJS.NodeJS.LTS"; Arreter "npm manquant" }
Ok "npm $(npm --version)"

# --- 2. Outils utiles (Claudetopia marche sans, mais certaines fonctions seront grisées) ---
Titre "Outils"
if (Present 'claude') { Ok "Claude Code $((claude --version) -split ' ' | Select-Object -First 1)" }
else { Avert "Claude Code absent : les sessions Claude ne marcheront pas" "npm install -g @anthropic-ai/claude-code   puis : claude (pour te connecter)" }
if (Present 'git') { Ok "Git" } else { Avert "Git absent : statut des projets, commits et journal indisponibles" "winget install Git.Git" }
if (Present 'wt') { Ok "Windows Terminal" } else { Avert "Windows Terminal absent : la souris et les onglets ne marcheront pas" "winget install Microsoft.WindowsTerminal" }
if (Present 'code') { Ok "VS Code" } else { Avert "VS Code absent : les boutons VS Code ne feront rien" "winget install Microsoft.VisualStudioCode" }
if (Present 'rg') { Ok "ripgrep" } else { Avert "ripgrep absent : /cherche indisponible" "winget install BurntSushi.ripgrep.MSVC" }
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
    if (-not (Present 'bun')) {
        winget install --id Oven-sh.Bun -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    }
    if (-not (Present 'bun')) { throw "Bun introuvable apres installation" }
    Push-Location (Join-Path $racine 'tui')
    try { bun install } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "code $LASTEXITCODE" }
    Ok "Bun $(bun --version) et la nouvelle interface"
} catch {
    Avert "Nouvelle interface indisponible ($_) : Claudetopia utilisera l'ancienne" "winget install Oven-sh.Bun   puis relance l'installation"
}

# --- 4. Node 24 pour la souris (sans toucher au Node du système) ---
Titre "Souris"
if ($majeure -ge 24) {
    Ok "Node $versionNode gere deja la souris"
} else {
    try {
        $v24 = (npx -y node@24 --version | Select-Object -Last 1)
        if (-not $v24) { throw "pas de version" }
        Ok "Node $v24 telecharge pour Claudetopia (le Node du systeme ne change pas)"
    } catch {
        Avert "Impossible de preparer Node 24 : Claudetopia marchera, mais sans la souris" "verifie ta connexion Internet puis relance l'installation"
    }
}

# --- 5. Raccourci sur le bureau ---
Titre "Raccourci"
try {
    $bureau = [Environment]::GetFolderPath('Desktop')
    $lien = Join-Path $bureau 'Claudetopia.lnk'
    $lanceur = Join-Path $racine 'Claudetopia.bat'
    # Ancien nom du logiciel
    Remove-Item (Join-Path $bureau 'CLI Perso.lnk') -ErrorAction SilentlyContinue
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lien)
    $wt = Get-Command wt -ErrorAction SilentlyContinue
    if ($wt) {
        $s.TargetPath = $wt.Source
        $s.Arguments = "-d `"$racine`" --title `"Claudetopia`" cmd /k `"$lanceur`""
        $s.IconLocation = "$($wt.Source),0"
    } else {
        $s.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $s.Arguments = "/k `"$lanceur`""
    }
    $s.WorkingDirectory = $racine
    $s.Description = 'Claudetopia : sessions et equipes Claude, projets, Git, Docker, SSH'
    $s.Save()
    Ok "Raccourci Claudetopia cree sur le bureau"
} catch {
    Avert "Impossible de creer le raccourci ($_)" "lance plutot Claudetopia.bat, ou /raccourci depuis Claudetopia"
}

# --- Résumé ---
Titre "Termine"
if ($problemes.Count -eq 0) {
    Write-Host "  Tout est pret. Au premier lancement, Claudetopia scanne le poste pour trouver tes projets." -ForegroundColor Green
} else {
    Write-Host "  Installe, mais $($problemes.Count) point(s) a corriger (voir ci-dessus)." -ForegroundColor Yellow
}
Write-Host "  Dans Claudetopia : /diagnostic verifie tout, /config regle comptes et interface, /maj met a jour." -ForegroundColor Gray
$reponse = Read-Host "Lancer Claudetopia maintenant ? (O/n)"
if ($reponse -notmatch '^[nN]') {
    if (Get-Command wt -ErrorAction SilentlyContinue) { Start-Process wt -ArgumentList "-d `"$racine`" --title `"Claudetopia`" cmd /k `"$(Join-Path $racine 'Claudetopia.bat')`"" }
    else { Start-Process cmd -ArgumentList "/k `"$(Join-Path $racine 'Claudetopia.bat')`"" }
}
