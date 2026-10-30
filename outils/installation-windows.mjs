import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as attendre } from 'node:timers/promises';

const ps = (s) => `'${s.replaceAll("'", "''")}'`;
const dans = (racine, cible) => { const rel = path.relative(path.resolve(racine), path.resolve(cible)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
export const sha256 = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Windows peut garder un runtime ou une DLL verrouillés juste après le diagnostic.
// On conserve le dossier vérifié et l'ancienne activation pendant les reprises.
export async function renommerAvecReprise(source, cible, progression = () => {}, renommer = fs.renameSync, pause = attendre) {
    for (let tentative = 0; ; tentative++) {
        try { renommer(source, cible); return; }
        catch (erreur) {
            if (!['EPERM', 'EACCES', 'EBUSY'].includes(erreur.code)) throw erreur;
            if (tentative === 14) throw new Error('Windows garde les fichiers d’installation verrouillés. La version actuelle est conservée ; ferme les fenêtres de réparation puis réessaie.', { cause: erreur });
            if (tentative === 0) progression({ titre: 'Finalisation de l’installation', detail: 'Windows libère encore les fichiers · nouvelle tentative automatique…', pourcentage: null });
            await pause(Math.min(200 * (tentative + 1), 1000));
        }
    }
}
const powershell = (script) => {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 180_000 });
    if (r.error || r.status !== 0) throw new Error(r.stderr?.trim() || r.error?.message || 'Opération Windows interrompue');
    return r.stdout.trim();
};
export function verifierPaquet(dossier, progression = () => {}) {
    const manifeste = JSON.parse(fs.readFileSync(path.join(dossier, 'distribution.json'), 'utf8'));
    if (manifeste.format !== 'agentopia-windows-v1' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifeste.id) || !Array.isArray(manifeste.fichiers)) throw new Error('Paquet Agentopia invalide');
    let controle = 0, dernier = -1;
    for (const entree of manifeste.fichiers) {
        const cible = path.resolve(dossier, entree.chemin);
        if (!dans(dossier, cible) || path.isAbsolute(entree.chemin) || !/^[a-f0-9]{64}$/.test(entree.sha256) || sha256(cible) !== entree.sha256) throw new Error(`Fichier incomplet ou modifié : ${entree.chemin}`);
        const pourcentage = Math.floor(++controle * 100 / Math.max(1, manifeste.fichiers.length));
        if (pourcentage !== dernier) { dernier = pourcentage; progression({ titre: 'Vérification des fichiers installés', detail: `${controle} fichiers sur ${manifeste.fichiers.length}`, pourcentage }); }
    }
    for (const requis of ['runtime/node.exe', 'runtime/bun.exe', 'dist/index.js', 'tui/app.tsx']) if (!manifeste.fichiers.some((f) => f.chemin === requis)) throw new Error(`Paquet incomplet : ${requis}`);
    return manifeste;
}
function extraireArchive(archive, destination, progression) {
    const script = String.raw`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem;
        $z=[IO.Compression.ZipFile]::OpenRead(${ps(archive)});
        try {
            foreach ($e in $z.Entries) { if ($e.FullName -match '(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)' ) { throw 'Chemin interdit dans le paquet' } }
            $racine=${ps(destination)}; [IO.Directory]::CreateDirectory($racine) | Out-Null; $i=0; $dernier=-1;
            foreach ($e in $z.Entries) {
                $cible=Join-Path $racine $e.FullName;
                if ($e.FullName.EndsWith('/') -or $e.FullName.EndsWith('\')) { [IO.Directory]::CreateDirectory($cible) | Out-Null }
                else { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($cible)) | Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,$cible,$false) }
                $i++; $pourcentage=[Math]::Floor($i*100/[Math]::Max(1,$z.Entries.Count));
                if ($pourcentage -ne $dernier) { $dernier=$pourcentage; [Console]::WriteLine('AGENTOPIA_EXTRACT '+$i+' '+$z.Entries.Count) }
            }
        } finally { $z.Dispose() }`;
    return new Promise((resoudre, rejeter) => {
        const p = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let erreur = '', expire = false;
        const delai = setTimeout(() => { expire = true; p.kill(); }, 180_000);
        p.stderr.on('data', (d) => { erreur = (erreur + d.toString()).slice(-4000); });
        const lignes = createInterface({ input: p.stdout });
        lignes.on('line', (ligne) => {
            const m = /^AGENTOPIA_EXTRACT (\d+) (\d+)$/.exec(ligne);
            if (m) progression({ titre: 'Installation des fichiers', detail: `${m[1]} fichiers sur ${m[2]}`, pourcentage: Math.floor(Number(m[1]) * 100 / Math.max(1, Number(m[2]))) });
        });
        p.once('error', (e) => { clearTimeout(delai); lignes.close(); rejeter(e); });
        p.once('close', (code) => { clearTimeout(delai); lignes.close(); code === 0 && !expire ? resoudre() : rejeter(new Error(expire ? 'La décompression a dépassé le délai prévu. Réessaie.' : erreur.trim() || 'Décompression interrompue')); });
    });
}
// Ce lanceur reste identique entre les versions. Le remplacement atomique du
// reçu est le seul point d'activation, y compris pour un retour arrière.
const LANCEUR = '@echo off\r\nsetlocal DisableDelayedExpansion\r\ntitle Agentopia\r\n'
    + 'set "AGENTOPIA_DISTRIBUTION_ROOT=%~dp0"\r\n'
    + '"%SystemRoot%\\System32\\findstr.exe" /r /b /c:"{\\"active\\":\\"[a-zA-Z0-9][a-zA-Z0-9._-]*\\"}" /c:"{\\"active\\":\\"[a-zA-Z0-9][a-zA-Z0-9._-]*\\",\\"precedente\\":\\"[a-zA-Z0-9][a-zA-Z0-9._-]*\\"}" "%~dp0activation.json" >nul 2>nul\r\n'
    + 'if errorlevel 1 (echo Activation Agentopia invalide. Relance Agentopia-Setup.exe. & exit /b 1)\r\n'
    + 'set "AGENTOPIA_VERSION="\r\n'
    + 'for /f "usebackq tokens=2 delims=:,{}" %%V in ("%~dp0activation.json") do if not defined AGENTOPIA_VERSION set "AGENTOPIA_VERSION=%%~V"\r\n'
    + 'setlocal EnableDelayedExpansion\r\nset "AGENTOPIA_INVALIDE=!AGENTOPIA_VERSION!"\r\n'
    + 'set "AGENTOPIA_DEBUT=!AGENTOPIA_VERSION:~0,1!"\r\n'
    + 'for %%C in (a b c d e f g h i j k l m n o p q r s t u v w x y z A B C D E F G H I J K L M N O P Q R S T U V W X Y Z 0 1 2 3 4 5 6 7 8 9) do (if defined AGENTOPIA_INVALIDE set "AGENTOPIA_INVALIDE=!AGENTOPIA_INVALIDE:%%C=!" & if defined AGENTOPIA_DEBUT set "AGENTOPIA_DEBUT=!AGENTOPIA_DEBUT:%%C=!")\r\n'
    + 'for %%C in (. _ -) do if defined AGENTOPIA_INVALIDE set "AGENTOPIA_INVALIDE=!AGENTOPIA_INVALIDE:%%C=!"\r\n'
    + 'if not defined AGENTOPIA_VERSION (echo Activation Agentopia absente. Relance Agentopia-Setup.exe. & exit /b 1)\r\n'
    + 'if defined AGENTOPIA_DEBUT (echo Activation Agentopia invalide. Relance Agentopia-Setup.exe. & exit /b 1)\r\n'
    + 'if defined AGENTOPIA_INVALIDE (echo Activation Agentopia invalide. Relance Agentopia-Setup.exe. & exit /b 1)\r\n'
    + 'setlocal DisableDelayedExpansion\r\n'
    + 'set "PATH=%~dp0versions\\%AGENTOPIA_VERSION%\\runtime;%PATH%"\r\n'
    + '"%~dp0versions\\%AGENTOPIA_VERSION%\\runtime\\node.exe" "%~dp0versions\\%AGENTOPIA_VERSION%\\dist\\index.js" %*\r\n';

function remplacerFichier(temporaire, fichier, renommer) {
    for (let tentative = 0; ; tentative++) {
        try { renommer(temporaire, fichier); return; }
        catch (e) {
            if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || tentative === 5) throw e;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 2 ** tentative);
        }
    }
}
export function activerVersion(destination, id, renommer = fs.renameSync) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error('Identifiant de version invalide');
    const version = path.join(destination, 'versions', id);
    verifierPaquet(version);
    const fichier = path.join(destination, 'activation.json');
    let ancienne; try {
        ancienne = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(ancienne?.active)) ancienne = undefined;
        else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(ancienne.precedente ?? '')) delete ancienne.precedente;
    } catch {}
    const nouvelle = { active: id, precedente: ancienne?.active === id ? ancienne.precedente : ancienne?.active };
    const lanceur = path.join(destination, 'Agentopia.cmd');
    const temporaireEtat = `${fichier}.${randomUUID()}.tmp`, temporaireLanceur = `${lanceur}.${randomUUID()}.tmp`;
    let ancienLanceur; try { ancienLanceur = fs.readFileSync(lanceur); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    let lanceurChange = false;
    try {
        // Préparer les deux fichiers avant de modifier quoi que ce soit.
        fs.writeFileSync(temporaireEtat, JSON.stringify(nouvelle));
        if (ancienLanceur?.toString('utf8') !== LANCEUR) {
            fs.writeFileSync(temporaireLanceur, LANCEUR);
            remplacerFichier(temporaireLanceur, lanceur, renommer);
            lanceurChange = true;
        }
        remplacerFichier(temporaireEtat, fichier, renommer);
    } catch (e) {
        if (lanceurChange) {
            try {
                if (ancienLanceur) {
                    fs.writeFileSync(temporaireLanceur, ancienLanceur);
                    remplacerFichier(temporaireLanceur, lanceur, fs.renameSync);
                } else fs.rmSync(lanceur, { force: true });
            } catch (retour) {
                throw new AggregateError([e, retour], 'Activation interrompue. Le reçu précédent est conservé ; relance Agentopia-Setup.exe pour rétablir le lanceur.');
            }
        }
        throw new Error('Activation interrompue : la version précédente est conservée. Réessaie la mise à jour.', { cause: e });
    } finally {
        fs.rmSync(temporaireEtat, { force: true }); fs.rmSync(temporaireLanceur, { force: true });
    }
    return nouvelle;
}
export async function installerArchive(archive, hashAttendu, options = {}) {
    const progression = options.progression || (() => {});
    if (process.platform !== 'win32') throw new Error('Ce paquet est prévu pour Windows');
    const destination = path.resolve(options.destination || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Agentopia'));
    if (!dans(os.homedir(), destination) && !dans(os.tmpdir(), destination)) throw new Error('Choisis un dossier dans ton profil utilisateur');
    progression({ titre: 'Préparation de l’installation', detail: 'Vérification du paquet…', pourcentage: null });
    if (sha256(archive) !== hashAttendu) throw new Error('Téléchargement incomplet ou modifié. La version actuelle est conservée.');
    fs.mkdirSync(destination, { recursive: true });
    const verrou = path.join(destination, 'installation.lock');
    // Un installateur interrompu ne bloque pas définitivement les prochaines tentatives.
    if (fs.existsSync(verrou)) {
        let ancien; try { ancien = JSON.parse(fs.readFileSync(verrou, 'utf8')); process.kill(ancien.pid, 0); } catch (e) {
            if (!ancien || e.code === 'ESRCH') fs.rmSync(verrou, { force: true });
        }
    }
    const fd = fs.openSync(verrou, 'wx'); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fs.closeSync(fd);
    const temporaire = path.join(destination, `.installation-${randomUUID()}`);
    try {
        console.log('Décompression et vérification d’Agentopia…');
        // Vérifier les entrées avant extraction, y compris les séparateurs Windows.
        progression({ titre: 'Installation des fichiers', detail: 'Ouverture du paquet…', pourcentage: 0 });
        await extraireArchive(archive, temporaire, progression);
        const manifeste = verifierPaquet(temporaire, progression);
        if ((options.idAttendu && manifeste.id !== options.idAttendu) || (options.versionAttendue && manifeste.version !== options.versionAttendue)) {
            throw new Error('Le paquet ne correspond pas à la version annoncée. La version actuelle est conservée.');
        }
        progression({ titre: 'Vérification du démarrage', detail: 'Test des moteurs et de l’interface…', pourcentage: null });
        const diagnostic = spawnSync(path.join(temporaire, 'runtime', 'node.exe'), [path.join(temporaire, 'dist', 'index.js'), '--verifier-installation'], {
            encoding: 'utf8', windowsHide: true, timeout: 60_000,
            env: { ...process.env, PATH: `${path.join(temporaire, 'runtime')}${path.delimiter}${process.env.PATH || ''}`, CLAUDETOPIA_DATA_DIR: path.join(temporaire, '.verification') },
        });
        if (diagnostic.error || diagnostic.status !== 0) throw new Error(`Vérification avant activation échouée : ${diagnostic.stderr || diagnostic.error?.message || 'interface indisponible'}`);
        progression({ titre: 'Finalisation de l’installation', detail: 'Préparation du lanceur et de la réparation hors ligne…', pourcentage: null });
        const id = options.reparer ? `${manifeste.id}-r${Date.now()}` : manifeste.id;
        const cible = path.join(destination, 'versions', id);
        if (!dans(destination, temporaire) || !dans(destination, cible)) throw new Error('Dossier de version invalide');
        fs.mkdirSync(path.dirname(cible), { recursive: true });
        if (fs.existsSync(cible)) verifierPaquet(cible);
        else await renommerAvecReprise(temporaire, cible, progression);
        // Garder le paquet permet une réparation hors ligne, sans compiler ni télécharger Node/Bun.
        const cache = path.join(destination, 'paquets'); fs.mkdirSync(cache, { recursive: true });
        const zip = path.join(cache, `${manifeste.id}.zip`);
        if (path.resolve(archive) !== zip) fs.copyFileSync(archive, zip);
        fs.writeFileSync(`${zip}.sha256`, hashAttendu);
        activerVersion(destination, id);
        if (options.raccourci !== false) {
            powershell(`$bureau=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $bureau 'Agentopia.lnk')); $s.TargetPath=$env:ComSpec; $s.Arguments='/c ""' + ${ps(path.join(destination, 'Agentopia.cmd'))} + '""'; $s.WorkingDirectory=$env:USERPROFILE; $s.Description='Agentopia : projets et agents'; $s.Save()`);
        }
        console.log('Agentopia est installé. Tes réglages et conversations sont conservés.');
        return { destination, id };
    } finally {
        // Les deux chemins viennent uniquement du dossier choisi et d'un UUID local.
        try {
            if (dans(destination, temporaire) && path.basename(temporaire).startsWith('.installation-')) {
                fs.rmSync(temporaire, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
            }
        } catch (erreur) {
            // Un nettoyage différé ne masque ni l'erreur d'installation ni son résultat.
            console.warn(`Dossier temporaire conservé, Windows le verrouille encore : ${temporaire} (${erreur.code})`);
        } finally { fs.rmSync(verrou, { force: true }); }
    }
}
