import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256 } from './installation-windows.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ps = (s) => `'${s.replaceAll("'", "''")}'`;
function executer(programme, args, cwd = racine) {
    const r = spawnSync(programme, args, { cwd, encoding: 'utf8', windowsHide: true, shell: programme === 'npm', maxBuffer: 16_000_000, timeout: 300_000 });
    if (r.error || r.status !== 0) throw new Error(`${programme} : ${r.stderr || r.stdout || r.error?.message}`);
    return r.stdout.trim();
}
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Construire sur Windows x64 avec les dépendances de cette plateforme');
const node = process.env.AGENTOPIA_BUILD_NODE || process.execPath;
const nodeVersion = executer(node, ['--version']);
if (Number(nodeVersion.slice(1).split('.')[0]) < 24) throw new Error('Node 24 ou supérieur est requis pour le paquet Windows. Définis AGENTOPIA_BUILD_NODE vers ce binaire.');
// npm installe un lanceur bun.cmd ; une installation native expose bun.exe.
// Demander son propre chemin au runtime couvre les deux installations.
const bun = process.env.AGENTOPIA_BUILD_BUN || executer('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; & bun -p process.execPath; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"]);
if (!bun || !fs.existsSync(bun)) throw new Error('Binaire Bun introuvable. Installe Bun ou définis AGENTOPIA_BUILD_BUN.');
const bunVersion = executer(bun, ['--version']);
executer('npm', ['run', 'build']);
executer(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tui', '--noEmit']);
const version = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'))).version;
const id = `${version}-${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
const sortie = path.join(racine, 'releases', id), paquet = path.join(sortie, 'portable');
fs.mkdirSync(paquet, { recursive: true });
const copier = (src, dest) => fs.cpSync(src, dest, { recursive: true, dereference: true });
// Liste fermée : aucune configuration personnelle, clé, conversation ou fichier Git dans le paquet.
for (const f of ['dist', 'outils', 'vendor', 'package.json', 'README.md', 'docs']) copier(path.join(racine, f), path.join(paquet, f));
for (const entree of fs.readdirSync(path.join(racine, 'tui'), { withFileTypes: true })) {
    if (entree.name === 'node_modules' || /^test-|^bench|^diag/.test(entree.name) || entree.name.endsWith('.lock')) continue;
    copier(path.join(racine, 'tui', entree.name), path.join(paquet, 'tui', entree.name));
}
console.log('Copie des dépendances d’exécution…');
for (const sousDossier of ['']) {
    const base = path.join(racine, sousDossier);
    // Seules les dépendances de production npm entrent dans le paquet.
    const liste = executer('npm', ['ls', '--omit=dev', '--all', '--parseable'], base).split(/\r?\n/).filter((p) => p.includes(`${path.sep}node_modules${path.sep}`));
    const racines = liste.filter((p) => !liste.some((autre) => autre !== p && p.startsWith(autre + path.sep)));
    for (const p of racines) {
        const relatif = path.relative(base, p);
        if (relatif.startsWith('..') || path.isAbsolute(relatif)) throw new Error(`Dépendance hors du paquet : ${p}`);
        copier(p, path.join(paquet, sousDossier, relatif));
    }
}
// Une installation propre évite d'embarquer les restes d'anciennes dépendances Bun.
fs.copyFileSync(path.join(racine, 'tui', 'bun.lock'), path.join(paquet, 'tui', 'bun.lock'));
executer(bun, ['install', '--frozen-lockfile', '--production', '--backend', 'copyfile', '--cache-dir', path.join(racine, 'releases', '.bun-cache')], path.join(paquet, 'tui'));
fs.mkdirSync(path.join(paquet, 'runtime'));
fs.copyFileSync(node, path.join(paquet, 'runtime', 'node.exe'));
fs.copyFileSync(bun, path.join(paquet, 'runtime', 'bun.exe'));
for (const [nom, source, url] of [
    ['node-LICENSE', `node-${nodeVersion}-LICENSE`, `https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`],
    ['bun-LICENSE', `bun-${bunVersion}-LICENSE`, `https://raw.githubusercontent.com/oven-sh/bun/bun-v${bunVersion}/LICENSE.md`],
]) {
    const locale = path.join(racine, 'vendor', 'runtime-licenses', source);
    if (fs.existsSync(locale)) fs.copyFileSync(locale, path.join(paquet, 'runtime', nom));
    else {
        const reponse = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!reponse.ok) throw new Error(`Licence ${nom} indisponible : ${reponse.status}`);
        fs.writeFileSync(path.join(paquet, 'runtime', nom), await reponse.text());
    }
}
fs.writeFileSync(path.join(paquet, 'Agentopia.cmd'), '@echo off\r\nsetlocal\r\ntitle Agentopia\r\nset "PATH=%~dp0runtime;%PATH%"\r\n"%~dp0runtime\\node.exe" "%~dp0dist\\index.js" %*\r\n');
const fichiers = [];
function indexer(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const cible = path.join(d, f.name);
        if (f.isDirectory()) indexer(cible);
        else fichiers.push({ chemin: path.relative(paquet, cible).replaceAll('\\', '/'), sha256: sha256(cible) });
    }
}
indexer(paquet);
fs.writeFileSync(path.join(paquet, 'distribution.json'), JSON.stringify({ format: 'agentopia-windows-v1', id, version, plateforme: 'win32-x64', runtimes: { node: nodeVersion, bun: bunVersion }, construite: new Date().toISOString(), fichiers }, null, 2));
console.log('Création du téléchargement Windows…');
const zip = path.join(sortie, 'Agentopia-Windows-x64.zip');
const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${ps(paquet)}, ${ps(zip)}, [IO.Compression.CompressionLevel]::Optimal, $false)`;
executer('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
const hash = sha256(zip);
const entree = path.join(sortie, 'installer.ts');
fs.writeFileSync(entree, `import payload from './Agentopia-Windows-x64.zip' with { type: 'file' };
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
import { installerArchive } from ${JSON.stringify(path.join(racine, 'outils', 'installation-windows.mjs'))};
const args=process.argv.slice(2); const cible=args.indexOf('--destination');
const temporaire=fs.mkdtempSync(path.join(os.tmpdir(),'agentopia-install-')); const archive=path.join(temporaire,'agentopia.zip');
try {
 await Bun.write(archive,Bun.file(payload));
 const r=await installerArchive(archive,${JSON.stringify(hash)},{destination:cible>=0?args[cible+1]:undefined,raccourci:!args.includes('--sans-raccourci')});
 if(!args.includes('--sans-lancer')) spawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(r.destination,'Agentopia.cmd')+'""'],{stdio:'inherit',windowsVerbatimArguments:true,env:{...process.env,CLAUDETOPIA_SCAN:'1'}});
} catch(e) { console.error('Installation interrompue :',e.message); process.exitCode=1; }
finally { const rel=path.relative(os.tmpdir(),temporaire); if(rel && !rel.startsWith('..') && !path.isAbsolute(rel) && path.basename(temporaire).startsWith('agentopia-install-')) fs.rmSync(temporaire,{recursive:true,force:true}); }
`);
executer(bun, ['build', '--compile', entree, '--outfile', path.join(sortie, 'Agentopia-Setup.exe')]);
fs.writeFileSync(path.join(sortie, 'agentopia-release.json'), JSON.stringify({ format: 'agentopia-release-v1', id, version, plateforme: 'win32-x64', asset: 'Agentopia-Windows-x64.zip', sha256: hash }, null, 2));
fs.writeFileSync(path.join(sortie, 'SHA256SUMS.txt'), `${hash}  Agentopia-Windows-x64.zip\n${sha256(path.join(sortie, 'Agentopia-Setup.exe'))}  Agentopia-Setup.exe\n`);
console.log(`Paquets prêts : ${sortie}`);
