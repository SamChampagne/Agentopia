import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import React from 'react';
import { render } from 'ink-testing-library';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-config-ink-'));
Object.assign(process.env, { CLAUDETOPIA_DATA_DIR: tmp, CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1', AGENTOPIA_SANS_MOTEUR: '1' });
// Aucun accès au trousseau, aux comptes ou à la configuration Git personnelle.
const chargeur = registerHooks({ load(url, contexte, suivant) {
    if (url.endsWith('/configCommandes.js')) return { format: 'module', shortCircuit: true, source: `export const compteClaude=async()=>({connecte:false}),identiteGit=()=>({nom:'Fixture',email:'fixture@example.invalid'}),cheminRaccourci=()=>${JSON.stringify(path.join(tmp, 'absent'))};` };
    if (url.endsWith('/compteGitHub.js')) return { format: 'module', shortCircuit: true, source: `export const etatCompteGitHub=async()=>({ok:true,texte:'@SamChampagneIntebec · connecté'});` };
    return suivant(url, contexte);
} });
const { VueConfig } = await import('./dist/ui/VueConfig.js');
const { bus } = await import('./dist/ui/bus.js');
let fermetures = 0;
const actions = [], lancer = a => actions.push(a), attendre = () => new Promise(r => setTimeout(r, 80));
const ui = render(React.createElement(VueConfig, { fermer: () => fermetures++ }));
try {
    bus.on('lancer', lancer); await attendre();
    ui.stdin.write('/'); await attendre(); ui.stdin.write('github'); await attendre();
    for (const largeur of [60, 80, 130]) {
        Object.defineProperties(ui.stdout, { columns: { value: largeur, configurable: true }, rows: { value: 28, configurable: true } });
        ui.rerender(React.createElement(VueConfig, { fermer: () => fermetures++ })); await attendre();
        assert.ok(ui.lastFrame().includes('@SamChampagneIntebec'), `valeur lisible à ${largeur}`);
        assert.ok(ui.lastFrame().includes('Compte GitHub')); assert.ok(!ui.lastFrame().includes('Compte Claude CLI'));
    }
    ui.stdin.write('\r'); ui.stdin.write('\r'); await attendre(); assert.equal(actions.length, 1); assert.deepEqual(actions.pop(), ['/compte github', '/config']);
    ui.rerender(React.createElement(VueConfig, { fermer: () => fermetures++ })); await attendre();
    ui.stdin.write('\u001b'); await attendre();
    ui.stdin.write('/'); await attendre(); ui.stdin.write('inexistantq'); await attendre();
    assert.ok(ui.lastFrame().includes('Aucun réglage trouvé')); assert.equal(fermetures, 1);
    ui.stdin.write('\r'); await attendre(); assert.equal(actions.length, 0);
    ui.stdin.write('\u0015'); await attendre(); assert.ok(!ui.lastFrame().includes('Aucun réglage trouvé'));
    ui.stdin.write('\u001b'); await attendre(); ui.stdin.write('\u001b'); await attendre(); assert.equal(fermetures, 2);
    console.log('CONFIG_INK_OK : recherche, valeur complète, annulation, vide et 60/80/130 colonnes');
} finally { bus.off('lancer', lancer); ui.unmount(); ui.cleanup(); chargeur.deregister(); fs.rmSync(tmp, { recursive: true, force: true }); }
