import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { activerVersion, renommerAvecReprise } from './outils/installation-windows.mjs';

test('installation : reprend un renommage temporairement verrouillé sans activer un autre dossier', async () => {
    const appels = [], attentes = [], etapes = [];
    await renommerAvecReprise('version-verifiee', 'destination', (e) => etapes.push(e), (source, cible) => {
        appels.push([source, cible]);
        if (appels.length <= 3) throw Object.assign(new Error('verrou fixture'), { code: ['EPERM', 'EBUSY', 'EACCES'][appels.length - 1] });
    }, async (ms) => { attentes.push(ms); });
    assert.equal(appels.length, 4);
    assert.ok(appels.every(([source, cible]) => source === 'version-verifiee' && cible === 'destination'));
    assert.deepEqual(attentes, [200, 400, 600]);
    assert.equal(etapes.length, 1); assert.match(etapes[0].detail, /tentative automatique/);
});

test('installation : un refus permanent reste borné et conserve sa cause', async () => {
    let appels = 0, attente = 0;
    const cause = Object.assign(new Error('refus fixture'), { code: 'EPERM' });
    await assert.rejects(renommerAvecReprise('source', 'cible', undefined, () => { appels++; throw cause; }, async (ms) => { attente += ms; }),
        (e) => e.cause === cause && /version actuelle est conservée/.test(e.message));
    assert.equal(appels, 15); assert.equal(attente, 12000);
});

test('installation : aucune reprise pour une erreur de chemin ou une destination déjà existante', async () => {
    for (const code of ['ENOENT', 'EEXIST', 'ENOSPC']) {
        const cause = Object.assign(new Error(code), { code }); let appels = 0;
        await assert.rejects(renommerAvecReprise('source', 'cible', undefined, () => { appels++; throw cause; }, async () => { assert.fail('attente inattendue'); }), (e) => e === cause);
        assert.equal(appels, 1);
    }
});

function installation(test) {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-activation (avec espaces ! &)-'));
    test.after(() => {
        const relatif = path.relative(os.tmpdir(), dossier);
        if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(dossier, { recursive: true, force: true });
    });
    for (const id of ['version-A', 'version-B']) {
        const version = path.join(dossier, 'versions', id);
        const fichiers = ['runtime/node.exe', 'runtime/bun.exe', 'dist/index.js', 'tui/app.tsx'].map((chemin) => {
            const fichier = path.join(version, chemin); fs.mkdirSync(path.dirname(fichier), { recursive: true });
            if (chemin === 'runtime/node.exe') fs.copyFileSync(process.execPath, fichier);
            else fs.writeFileSync(fichier, chemin === 'dist/index.js' ? `console.log(JSON.stringify({ version: '${id}', args: process.argv.slice(2) }));` : 'fixture');
            return { chemin, sha256: createHash('sha256').update(fs.readFileSync(fichier)).digest('hex') };
        });
        fs.writeFileSync(path.join(version, 'distribution.json'), JSON.stringify({ format: 'agentopia-windows-v1', id, fichiers }));
    }
    return dossier;
}

test('activation : un refus du reçu conserve le lanceur précédent et l’état actif', (t) => {
    const dossier = installation(t);
    activerVersion(dossier, 'version-A');
    const lanceur = path.join(dossier, 'Agentopia.cmd');
    // Migration d'un ancien lanceur contenant une version fixe.
    fs.writeFileSync(lanceur, '@echo version-A\r\n');
    const avant = fs.readFileSync(lanceur, 'utf8');
    assert.throws(() => activerVersion(dossier, 'version-B', (source, cible) => {
        if (path.basename(cible) === 'activation.json') throw Object.assign(new Error('refus fixture'), { code: 'EPERM' });
        fs.renameSync(source, cible);
    }), /version précédente est conservée/);
    assert.equal(fs.readFileSync(lanceur, 'utf8'), avant);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dossier, 'activation.json'))).active, 'version-A');
    assert.equal(fs.readdirSync(dossier).some((f) => f.endsWith('.tmp')), false);
});

test('activation : le même lanceur suit le reçu atomique et le retour arrière', { skip: process.platform !== 'win32' }, (t) => {
    const dossier = installation(t), lanceur = path.join(dossier, 'Agentopia.cmd');
    const lancer = () => spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${lanceur}" "bonjour!""`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true });
    activerVersion(dossier, 'version-A');
    const contenu = fs.readFileSync(lanceur, 'utf8');
    let r = lancer(); assert.equal(r.status, 0, r.stdout + r.stderr); assert.deepEqual(JSON.parse(r.stdout), { version: 'version-A', args: ['bonjour!'] });
    activerVersion(dossier, 'version-B');
    assert.equal(fs.readFileSync(lanceur, 'utf8'), contenu);
    r = lancer(); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).version, 'version-B');
    activerVersion(dossier, JSON.parse(fs.readFileSync(path.join(dossier, 'activation.json'))).precedente);
    assert.equal(JSON.parse(lancer().stdout).version, 'version-A');
    const marqueur = path.join(dossier, 'injection.txt');
    for (const id of ['.', '..', '...', '../ailleurs', 'version-A,invalide', 'version-A:invalide', 'version-A}invalide', 'version-A & echo injection', `version-A"&echo injection>"${marqueur}"&rem "`, 'version-A!PATH!', 'version-A%PATH%']) {
        assert.throws(() => activerVersion(dossier, id), /Identifiant/);
        fs.writeFileSync(path.join(dossier, 'activation.json'), JSON.stringify({ active: id }));
        const refus = lancer(); assert.notEqual(refus.status, 0); assert.doesNotMatch(refus.stdout, /version.*args|^injection$/m);
        assert.equal(fs.existsSync(marqueur), false, 'aucune interprétation du reçu comme commande');
    }
});
