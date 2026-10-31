import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifierCheminPhysique, validerCheminPaquet } from './installation-windows.mjs';
const idValide = id => typeof id === 'string' && id.length <= 180 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) && !/[.]$/.test(id);
const dans = (r, f) => { const p = path.relative(path.resolve(r), path.resolve(f)); return !!p && p !== '..' && !p.startsWith(`..${path.sep}`) && !path.isAbsolute(p); };
const ps = s => `'${s.replace(/['\u2018-\u201b]/g, c => c + c)}'`;
function json(f, max = 8 * 1024 * 1024) { const st = verifierCheminPhysique(f); if (!st?.isFile() || st.size > max) throw new Error('Métadonnées d’installation invalides'); return JSON.parse(fs.readFileSync(f, 'utf8')); }
function manifeste(root, id) {
    if (!idValide(id)) throw new Error('Identifiant de version invalide');
    const dossier = path.join(root, 'versions', id), m = json(path.join(dossier, 'distribution.json'));
    if (!idValide(m.id) || m.format !== 'agentopia-windows-v1' || !Array.isArray(m.fichiers) || m.fichiers.length > 50_000) throw new Error('Manifeste invalide');
    const vus = new Set();
    for (const f of m.fichiers) { const cle = validerCheminPaquet(f?.chemin).toLowerCase(); if (vus.has(cle) || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('Manifeste invalide'); vus.add(cle); }
    return { dossier, m };
}
export function processusInstallation(root, executer = spawnSync) {
    if (process.platform !== 'win32') return [];
    const r = executer('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | Select-Object ProcessId,ExecutablePath)"], { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error('Impossible de vérifier les programmes ouverts. Ferme Agentopia puis réessaie.');
    const liste = JSON.parse(r.stdout || '[]'); if (!Array.isArray(liste)) throw new Error('Inventaire des processus invalide');
    return liste.filter(p => Number.isInteger(p.ProcessId) && p.ProcessId > 0 && typeof p.ExecutablePath === 'string' && dans(root, p.ExecutablePath)).map(p => ({ pid: p.ProcessId, executable: p.ExecutablePath }));
}
export function inventorierInstallation(root, options = {}) {
    root = path.resolve(root); verifierCheminPhysique(root);
    const activation = json(path.join(root, 'activation.json'), 64 * 1024);
    if (!idValide(activation.active) || activation.precedente !== undefined && !idValide(activation.precedente)) throw new Error('Activation invalide');
    const processus = options.processus ?? processusInstallation(root), proteges = new Set([activation.active, activation.precedente].filter(Boolean));
    for (const p of [...processus.map(p => p.executable), ...(options.racineCourante ? [options.racineCourante] : [])]) {
        const rel = path.relative(path.join(root, 'versions'), path.resolve(p)).split(path.sep); if (rel[0] && idValide(rel[0])) proteges.add(rel[0]);
    }
    const versions = [], archives = [], paquetsProteges = new Set(); let cacheIndetermine = false;
    const baseVersions = path.join(root, 'versions'); verifierCheminPhysique(baseVersions);
    for (const id of fs.readdirSync(baseVersions)) {
        if (!idValide(id)) continue;
        try {
            const { dossier, m } = manifeste(root, id); let octets = 0;
            for (const f of m.fichiers) { const st = verifierCheminPhysique(path.join(dossier, validerCheminPaquet(f.chemin))); if (st?.isFile()) octets += st.size; }
            const protegee = proteges.has(id); if (protegee) paquetsProteges.add(m.id);
            versions.push({ id, version: m.version, octets, protegee, paquet: m.id });
        } catch { if (proteges.has(id)) cacheIndetermine = true; versions.push({ id, octets: 0, protegee: true, erreur: 'Version non reconnue : fichiers conservés.' }); }
    }
    const cache = path.join(root, 'paquets'); verifierCheminPhysique(cache);
    if (fs.existsSync(cache)) for (const nom of fs.readdirSync(cache).filter(n => n.endsWith('.zip'))) {
        const id = nom.slice(0, -4); if (!idValide(id)) continue;
        const st = verifierCheminPhysique(path.join(cache, nom)); if (st?.isFile()) archives.push({ id, octets: st.size, protegee: cacheIndetermine || paquetsProteges.has(id) });
    }
    return { root, activation, versions, archives, processus };
}
function sousVerrouInstallation(root, fn) {
    const verrou = path.join(root, 'installation.lock'); verifierCheminPhysique(verrou);
    const fd = fs.openSync(verrou, 'wx'); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd);
    try { return fn(); } finally { fs.unlinkSync(verrou); }
}
function retirerVersion(root, id) {
    const { dossier, m } = manifeste(root, id);
    // Valider toutes les cibles avant la première suppression. Les fichiers
    // ajoutés par l'utilisateur ne figurent pas au manifeste : ils restent.
    const cibles = m.fichiers.map(f => path.join(dossier, validerCheminPaquet(f.chemin)));
    for (const f of cibles) { if (!dans(dossier, f)) throw new Error('Cible hors de la version'); verifierCheminPhysique(f); }
    for (const f of cibles) if (fs.existsSync(f)) fs.unlinkSync(f);
    const parents = new Set(cibles.flatMap(f => { const r = []; for (let d = path.dirname(f); dans(dossier, d); d = path.dirname(d)) r.push(d); return r; }));
    for (const d of [...parents].sort((a, b) => b.length - a.length)) { try { fs.rmdirSync(d); } catch { /* Contenu non possédé : conserver. */ } }
    fs.unlinkSync(path.join(dossier, 'distribution.json')); try { fs.rmdirSync(dossier); } catch { /* Conserver les fichiers inconnus. */ }
}
export function nettoyerInstallation(root, selection, options = {}) {
    root = path.resolve(root); verifierCheminPhysique(root);
    return sousVerrouInstallation(root, () => {
        const inventaire = inventorierInstallation(root, options);
        if (!selection || !Array.isArray(selection.versions) || !Array.isArray(selection.archives)) throw new Error('Sélection invalide');
        for (const id of selection.versions) if (!inventaire.versions.some(v => v.id === id && !v.protegee)) throw new Error('Version protégée ou inconnue : aucun nettoyage.');
        for (const id of selection.archives) if (!inventaire.archives.some(v => v.id === id && !v.protegee)) throw new Error('Archive protégée ou inconnue : aucun nettoyage.');
        for (const id of new Set(selection.versions)) retirerVersion(root, id);
        for (const id of new Set(selection.archives)) for (const suffixe of ['.zip', '.zip.sha256']) { const f = path.join(root, 'paquets', id + suffixe); verifierCheminPhysique(f); if (fs.existsSync(f)) fs.unlinkSync(f); }
        return { versions: selection.versions.length, archives: selection.archives.length };
    });
}
export function scriptDesinstallation(root) {
    root = path.resolve(root);
    // Le script est généré localement, puis copié dans TEMP avant toute suppression.
    // Aucun profil .claudetopia*, projet, CLI ou clé privée n'est une cible.
    return `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; $r=${ps(root)}; `
        + `if ([Windows.Forms.MessageBox]::Show('Désinstaller Agentopia et fermer ses processus ? Tes réglages, conversations, projets et comptes seront conservés.','Agentopia',4,32,256) -ne 'Yes') { exit }; `
        + `$exe=Join-Path $r 'Desinstaller-Agentopia.mjs'; $etat=Get-Content -LiteralPath (Join-Path $r 'activation.json') -Raw | ConvertFrom-Json; `
        + `if ($etat.active -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*$') { throw 'Activation invalide' }; `
        + `$racineTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\'); $tmp=Join-Path $racineTemp ('agentopia-retrait-'+[Guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $tmp | Out-Null; `
        + `Copy-Item -LiteralPath (Join-Path $r ('versions\\'+$etat.active+'\\runtime\\node.exe')) -Destination (Join-Path $tmp 'node.exe'); `
        + `Copy-Item -LiteralPath $exe -Destination (Join-Path $tmp 'retrait.mjs'); `
        + `& (Join-Path $tmp 'node.exe') (Join-Path $tmp 'retrait.mjs') $r; if ($LASTEXITCODE -ne 0) { throw 'Désinstallation interrompue. Ferme Agentopia puis réessaie.' }; `
        + `[Windows.Forms.MessageBox]::Show('Agentopia retiré. Les données personnelles sont conservées.','Agentopia') | Out-Null; `
        + `$finTemp=[IO.Path]::GetFullPath($tmp); if (![String]::Equals([IO.Path]::GetDirectoryName($finTemp),$racineTemp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($finTemp) -notmatch '^agentopia-retrait-[a-f0-9]{32}$' -or ((Get-Item -LiteralPath $finTemp).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Nettoyage temporaire refusé : chemin inattendu' }; `
        + `Remove-Item -LiteralPath $finTemp -Recurse -Force`;
}
export function preparerDesinstallation(root, enregistrer = true) {
    root = path.resolve(root); verifierCheminPhysique(root);
    for (const n of ['Desinstaller-Agentopia.cmd', 'Desinstaller-Agentopia.mjs']) verifierCheminPhysique(path.join(root, n));
    const script = scriptDesinstallation(root);
    const commande = `"${path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')}" -NoProfile -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
    fs.writeFileSync(path.join(root, 'Desinstaller-Agentopia.cmd'), `@echo off\r\n${commande}\r\n`, { mode: 0o600 });
    // Ce worker autonome n'importe rien du dossier qu'il supprime.
    fs.copyFileSync(new URL('./retrait-windows.mjs', import.meta.url), path.join(root, 'Desinstaller-Agentopia.mjs'));
    if (enregistrer) {
        const s = `$ErrorActionPreference='Stop'; $k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Agentopia'; New-Item -Path $k -Force | Out-Null; `
            + `New-ItemProperty -Path $k -Name DisplayName -Value 'Agentopia' -PropertyType String -Force | Out-Null; `
            + `New-ItemProperty -Path $k -Name UninstallString -Value ${ps(commande)} -PropertyType String -Force | Out-Null; `
            + `New-ItemProperty -Path $k -Name InstallLocation -Value ${ps(root)} -PropertyType String -Force | Out-Null; `
            + `New-ItemProperty -Path $k -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null; New-ItemProperty -Path $k -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null`;
        const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(s, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
        if (r.error || r.status !== 0) throw new Error('Installation terminée, mais inscription dans Applications Windows impossible. Utilise Desinstaller-Agentopia.cmd.');
    }
}
