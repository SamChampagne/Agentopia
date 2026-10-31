import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { construireInstallateur } from './outils/construire-installateur.mjs';
import { sha256 } from './outils/installation-windows.mjs';

if (process.platform !== 'win32' || !process.argv[2]) throw new Error('Usage : node test-telechargement-windows.mjs releases/<identifiant>');
const release = path.resolve(process.argv[2]), zip = path.join(release, 'Agentopia-Windows-x64.zip');
const manifeste = JSON.parse(fs.readFileSync(path.join(release, 'agentopia-release.json')));
const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-telechargement-test-'));
let mode = 'complet';
const serveur = http.createServer((req, res) => {
    if (mode === 'indisponible') { res.writeHead(503); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': fs.statSync(zip).size });
    if (mode === 'tronque') { res.end(Buffer.from('incomplet')); return; }
    if (mode === 'modifie') { res.write(Buffer.from('X')); fs.createReadStream(zip, { start: 1 }).pipe(res); return; }
    fs.createReadStream(zip).pipe(res);
});
await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
try {
    const exe = construireInstallateur(path.join(temporaire, 'bootstrap'), { ...manifeste, taille: fs.statSync(zip).size,
        url: `http://127.0.0.1:${serveur.address().port}/paquet.zip`, testLocal: true });
    // DLL inerte : le nouveau bootstrap ne doit pas charger le winmm.dll voisin.
    fs.writeFileSync(path.join(path.dirname(exe), 'winmm.dll'), 'Fichier inerte du test de régression');
    for (mode of ['complet', 'indisponible', 'tronque', 'modifie']) {
        const destination = path.join(temporaire, mode), journal = path.join(temporaire, `${mode}.log`);
        const code = await new Promise((resoudre, rejeter) => {
            const p = spawn(exe, ['--destination', destination, '--sans-raccourci', '--sans-enregistrement', '--sans-lancer', '--silencieux', '--journal', journal], { windowsHide: true,
                env: { ...process.env, CLAUDETOPIA_DATA_DIR: path.join(temporaire, 'profil'), CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1' } });
            const limite = setTimeout(() => { p.kill(); rejeter(new Error(`Délai dépassé : ${mode}`)); }, 240_000);
            p.on('error', (e) => { clearTimeout(limite); rejeter(e); });
            p.on('exit', (c) => { clearTimeout(limite); resoudre(c); });
        });
        const log = fs.readFileSync(journal, 'utf8');
        assert.equal(code, mode === 'complet' ? 0 : 1, log.slice(-4000));
        if (mode === 'complet') {
            assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'activation.json'))).active, manifeste.id);
            const progressions = log.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(JSON.parse).filter((x) => x.type === 'progression').map((x) => JSON.parse(x.message));
            assert.ok(progressions.some((p) => p.etape === 'telechargement' && p.pourcentage > 0 && p.pourcentage < 100), 'Progression intermédiaire du réseau absente');
            assert.ok(progressions.some((p) => p.titre === 'Installation des fichiers' && p.pourcentage > 0 && p.pourcentage < 100));
            assert.equal(progressions.at(-1).etape, 'termine');
            assert.equal(sha256(zip), manifeste.sha256);
        } else {
            assert.equal(fs.existsSync(path.join(destination, 'activation.json')), false, 'Aucune activation après un téléchargement invalide');
            assert.ok(log.includes('erreur'));
            if (mode === 'indisponible') assert.match(log, /HTTP 503/);
            if (mode === 'modifie') assert.match(log, /incomplet ou modifié/);
        }
        console.log(`Téléchargement ${mode} : OK`);
    }
} finally {
    serveur.closeAllConnections(); await new Promise((r) => serveur.close(r));
    const relatif = path.relative(os.tmpdir(), temporaire);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif) && path.basename(temporaire).startsWith('agentopia-telechargement-test-')) fs.rmSync(temporaire, { recursive: true, force: true });
}
