import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renommerAvecReprise } from './outils/installation-windows.mjs';

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
