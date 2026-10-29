import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

if (process.platform !== 'win32' || !process.argv[2]) throw new Error('Usage : node test-installation-windows.mjs releases/<identifiant>');
const release = path.resolve(process.argv[2]);
const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-installation-test-'));
const destination = path.join(temporaire, 'Installation avec espaces'), donnees = path.join(temporaire, 'profil');
fs.mkdirSync(donnees);
const temoin = path.join(donnees, 'conversation-a-preserver.json'); fs.writeFileSync(temoin, '{"message":"à conserver"}');
const systeme = process.env.SystemRoot || 'C:\\Windows';
const env = { ...process.env, PATH: [path.join(systeme, 'System32'), path.join(systeme, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    CLAUDETOPIA_DATA_DIR: donnees, CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1' };
function lancer(programme, args, options = {}) {
    const r = spawnSync(programme, args, { encoding: 'utf8', windowsHide: true, timeout: 180_000, env, ...options });
    assert.equal(r.status, 0, `${programme} : ${r.error?.message || r.stderr || r.stdout}`);
    return r.stdout;
}
try {
    console.log('Installation du vrai Setup dans un dossier isolé…');
    lancer(path.join(release, 'Agentopia-Setup.exe'), ['--destination', destination, '--sans-raccourci', '--sans-lancer']);
    const activation = () => JSON.parse(fs.readFileSync(path.join(destination, 'activation.json'), 'utf8'));
    const initiale = activation().active;
    const version = path.join(destination, 'versions', initiale);
    const { installerArchive, activerVersion, verifierPaquet, sha256 } = await import(pathToFileURL(path.join(version, 'outils', 'installation-windows.mjs')).href);
    verifierPaquet(version);
    console.log('Lancement via le raccourci de commande avec un PATH sans Node/Bun…');
    const sortie = lancer(process.env.ComSpec || path.join(systeme, 'System32', 'cmd.exe'), ['/d', '/s', '/c', `""${path.join(destination, 'Agentopia.cmd')}" --verifier-installation"`], { windowsVerbatimArguments: true });
    assert.match(sortie, /moteurs, dépendances et interface vérifiés/);
    assert.match(lancer(path.join(version, 'runtime', 'node.exe'), ['--version']), /^v(?:2[4-9]|[3-9]\d)\./);
    assert.ok(lancer(path.join(version, 'runtime', 'bun.exe'), ['--version']).trim());
    const archive = path.join(destination, 'paquets', `${initiale}.zip`);
    const hash = fs.readFileSync(`${archive}.sha256`, 'utf8').trim();
    assert.equal(sha256(archive), hash);
    console.log('Réparation depuis le paquet local puis retour à la version précédente…');
    const reparee = await installerArchive(archive, hash, { destination, reparer: true, raccourci: false });
    assert.notEqual(reparee.id, initiale); assert.equal(activation().precedente, initiale);
    assert.equal(activation().active, reparee.id);
    activerVersion(destination, activation().precedente);
    assert.equal(activation().active, initiale);
    const fichier = path.join(destination, 'versions', reparee.id, 'dist', 'index.js');
    fs.appendFileSync(fichier, '\n// corruption simulée\n');
    assert.throws(() => activerVersion(destination, reparee.id), /modifié/);
    assert.equal(activation().active, initiale);
    await assert.rejects(installerArchive(archive, '0'.repeat(64), { destination, raccourci: false }), /incomplet ou modifié/);
    assert.equal(activation().active, initiale);
    assert.equal(fs.readFileSync(temoin, 'utf8'), '{"message":"à conserver"}');
    console.log('✓ Setup, runtimes inclus, interface, réparation, retour arrière, contrôle d’intégrité et données préservées');
} finally {
    const rel = path.relative(os.tmpdir(), temporaire);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && path.basename(temporaire).startsWith('agentopia-installation-test-')) fs.rmSync(temporaire, { recursive: true, force: true });
}
