[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Values are held in memory only and sent to gh through stdin. Never echo the token.
$previousGhToken = $env:GH_TOKEN
$secureToken = $null
$projectToken = $null
$uploadToken = $null
try {
    $uploadToken = (& gh auth token --hostname github.com --user SamChampagne 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $uploadToken) { throw 'Connecter le compte source SamChampagne dans GitHub CLI avant cette préparation.' }
    $secureToken = Read-Host 'Jeton classique dédié de SamChampagneIntebec (repo + project), saisie masquée' -AsSecureString
    $projectToken = [System.Net.NetworkCredential]::new('', $secureToken).Password
    if (-not $projectToken) { throw 'Jeton vide.' }
    $headers = @{Authorization="Bearer $projectToken";Accept='application/vnd.github+json';'X-GitHub-Api-Version'='2022-11-28'}
    try {
        $response = Invoke-WebRequest -Uri 'https://api.github.com/user' -Headers $headers
        $identity = $response.Content | ConvertFrom-Json
        if ($identity.login -ne 'SamChampagneIntebec') { throw 'identity' }
        $scopes = ($response.Headers['X-OAuth-Scopes'] -join ',').Split(',').Trim()
        if ('repo' -notin $scopes -or 'project' -notin $scopes) { throw 'scopes' }
        $membership = Invoke-RestMethod -Uri 'https://api.github.com/user/memberships/orgs/Intebec' -Headers $headers
        if ($membership.state -ne 'active' -or $membership.role -ne 'admin') { throw 'membership' }
    } catch { throw 'Jeton non validé : utiliser SamChampagneIntebec, accès actif propriétaire Intebec, scopes classiques repo + project. Aucune valeur affichée.' }
    $env:GH_TOKEN = $uploadToken
    foreach ($repo in @('Pulsar','Agentopia','Cadence','PlaniAdvanceV2')) {
        $projectToken | & gh secret set PROJECTS_TOKEN_INTEBEC --repo "SamChampagne/$repo" --app actions
        if ($LASTEXITCODE -ne 0) { throw "Échec d’enregistrement pour $repo; les dépôts déjà confirmés restent configurés. Relancer est sans danger." }
        Write-Host "PROJECTS_TOKEN_INTEBEC enregistré : $repo"
    }
    Write-Host 'Préparation terminée. PROJECTS_TOKEN actuel conservé; aucun dépôt transféré.'
} finally {
    $env:GH_TOKEN = $previousGhToken
    $projectToken = $null
    $uploadToken = $null
    $headers = $null
    if ($secureToken) { $secureToken.Dispose() }
}
