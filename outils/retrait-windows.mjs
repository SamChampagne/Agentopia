// Worker autonome copié dans TEMP : aucune dépendance au logiciel en cours de retrait.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ps = s => `'${s.replace(/['\u2018-\u201b]/g, c => c + c)}'`;
const dans = (r, f) => { const p = path.relative(r, f); return !!p && p !== '..' && !p.startsWith(`..${path.sep}`) && !path.isAbsolute(p); };
function physique(f) {
    const p = path.dirname(f); if (p !== f) physique(p);
    try { const s = fs.lstatSync(f); if (s.isSymbolicLink() || s.isFile() && s.nlink !== 1 || !s.isFile() && !s.isDirectory()) throw new Error('Lien ou fichier spécial refusé'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
}
function json(f) { physique(f); const s = fs.statSync(f); if (!s.isFile() || s.size > 8 * 1024 * 1024) throw new Error('Métadonnées invalides'); return JSON.parse(fs.readFileSync(f, 'utf8')); }
function chemin(n) {
    if (typeof n !== 'string' || !n || n.length > 4000) throw new Error('Chemin invalide');
    const p = n.replaceAll('\\', '/').split('/');
    if (p.some(x => !x || x === '.' || x === '..' || /[\x00-\x1f<>:"|?*]/.test(x) || /[. ]$/.test(x) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(x))) throw new Error('Chemin invalide');
    return p;
}
function powershell(s) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(s, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error('Windows n’a pas terminé le retrait. Les données personnelles restent conservées.'); return r.stdout.trim();
}
function processus(root) {
    const liste = JSON.parse(powershell("ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath} | Select-Object ProcessId,ExecutablePath)"));
    return liste.filter(p => Number.isInteger(p.ProcessId) && p.ProcessId > 0 && typeof p.ExecutablePath === 'string' && dans(root, path.resolve(p.ExecutablePath)));
}
function integration(root) {
    powershell(`$ErrorActionPreference='Stop'; $r=${ps(root)}; $k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Agentopia'; `
        + `if (Test-Path -LiteralPath $k) { if ((Get-ItemProperty -LiteralPath $k).InstallLocation -eq $r) { Remove-Item -LiteralPath $k -Recurse -Force } }; `
        + `$l=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Agentopia.lnk'; if (Test-Path -LiteralPath $l) { $s=(New-Object -ComObject WScript.Shell).CreateShortcut($l); if ($s.Arguments.Contains((Join-Path $r 'Agentopia.cmd'))) { Remove-Item -LiteralPath $l } }`);
}
export function retirerInstallation(root, options = {}) {
    root = path.resolve(root); physique(root);
    if (root === path.parse(root).root || root.length < 10) throw new Error('Destination de retrait invalide');
    const activation = json(path.join(root, 'activation.json'));
    if (typeof activation.active !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(activation.active)) throw new Error('Installation non reconnue');
    const lister = options.listerProcessus || processus;
    const arreter = options.arreterProcessus || (pid => { const r = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 }); if (r.error) throw r.error; });
    for (const p of lister(root)) if (lister(root).some(q => q.ProcessId === p.ProcessId && q.ExecutablePath === p.ExecutablePath)) arreter(p.ProcessId);
    if (lister(root).length) throw new Error('Agentopia est encore ouvert. Aucun fichier supprimé.');
    const verrou = path.join(root, 'installation.lock'); physique(verrou);
    const fd = fs.openSync(verrou, 'wx'); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd);
    try {
        const cibles = [], dossiers = new Set();
        const versions = path.join(root, 'versions'); physique(versions);
        for (const id of fs.readdirSync(versions)) {
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) continue;
            const d = path.join(versions, id); physique(d);
            if (!fs.existsSync(path.join(d, 'distribution.json'))) continue; // Restes non possédés conservés.
            const m = json(path.join(d, 'distribution.json'));
            if (m.format !== 'agentopia-windows-v1' || !Array.isArray(m.fichiers) || m.fichiers.length > 50_000) throw new Error('Version non reconnue : retrait interrompu');
            const fichiers = [...m.fichiers.map(f => path.join(d, ...chemin(f.chemin))), path.join(d, 'distribution.json')];
            for (const f of fichiers) { if (!dans(d, f)) throw new Error('Fichier hors de la version'); cibles.push(f); for (let p = path.dirname(f); dans(root, p); p = path.dirname(p)) dossiers.add(p); }
        }
        const cache = path.join(root, 'paquets'); physique(cache);
        if (fs.existsSync(cache)) for (const n of fs.readdirSync(cache)) if (/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.zip(?:\.sha256)?$/.test(n)) cibles.push(path.join(cache, n));
        dossiers.add(cache);
        for (const n of ['Agentopia.cmd', 'Desinstaller-Agentopia.cmd', 'Desinstaller-Agentopia.mjs', 'installation-options.json', 'activation.json']) cibles.push(path.join(root, n));
        for (const f of cibles) { if (!dans(root, f)) throw new Error('Cible invalide'); physique(f); }
        // Retirer l'intégration seulement après validation des fichiers.
        (options.retirerIntegration || integration)(root);
        for (const f of cibles) if (fs.existsSync(f)) fs.unlinkSync(f);
        for (const d of [...dossiers].sort((a, b) => b.length - a.length)) { try { fs.rmdirSync(d); } catch { /* Fichiers ajoutés par l'utilisateur conservés. */ } }
    } finally { fs.unlinkSync(verrou); }
    try { fs.rmdirSync(root); } catch { /* Contenu non possédé : conserver. */ }
    return { donneesConservees: true, restes: fs.existsSync(root) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { if (!process.argv[2]) throw new Error('Installation à retirer manquante'); retirerInstallation(process.argv[2]); }
    catch (e) { console.error(e.message); process.exitCode = 1; }
}
