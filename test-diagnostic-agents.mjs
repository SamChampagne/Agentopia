import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-diagnostic-test-'));
process.env.CLAUDETOPIA_DATA_DIR = racine;
after(() => {
    const relatif = path.relative(os.tmpdir(), racine);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(racine, { recursive: true, force: true });
});
const { diagnostiquerAgents } = await import('./dist/diagnosticAgents.js');

test('diagnostic : tous les fournisseurs intégrés vérifiés sans génération', async () => {
    const appels = [];
    const resultat = await diagnostiquerAgents({ fournisseurDefaut: 'codex' }, async (f) => {
        appels.push(f); return { pret: f === 'codex', texte: f === 'codex' ? 'Compte connecté' : 'Clé manquante' };
    });
    assert.deepEqual(appels.sort(), ['claude', 'codex', 'perplexity']);
    assert.equal(resultat.find((v) => v.quoi === 'Codex intégré').niveau, 'ok');
    assert.equal(resultat.find((v) => v.quoi === 'Claude intégré').niveau, 'avert');
    assert.equal(resultat.some((v) => v.niveau === 'erreur'), false);
});

test('diagnostic : agent par défaut indisponible signalé même si un autre fonctionne', async () => {
    const resultat = await diagnostiquerAgents({ fournisseurDefaut: 'codex' }, async (f) => ({ pret: f === 'claude', texte: 'État fixture' }));
    const codex = resultat.find((v) => v.quoi === 'Codex intégré');
    assert.equal(codex.niveau, 'erreur'); assert.match(codex.solution, /connexions/);
    assert.match(codex.detail, /par défaut/);
});

test('diagnostic : aucun fournisseur disponible ne peut être annoncé non bloquant', async () => {
    const resultat = await diagnostiquerAgents({ fournisseurDefaut: 'choisir' }, async () => { throw new Error('secret-qui-ne-doit-pas-etre-affiche'); });
    assert.equal(resultat[0].niveau, 'erreur'); assert.equal(resultat[0].quoi, 'Sessions intégrées');
    assert.doesNotMatch(JSON.stringify(resultat), /secret-qui-ne-doit-pas/);
    assert.equal(resultat.length, 4);
});
