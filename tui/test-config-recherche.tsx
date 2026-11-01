import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-config-ui-'));
Object.assign(process.env, { CLAUDETOPIA_DATA_DIR: tmp, CLAUDETOPIA_TEST_UI: '1', CLAUDETOPIA_SANS_REPRISE: '1', AGENTOPIA_SANS_MOTEUR: '1' });
const commandes = await import('../dist/configCommandes.js');
mock.module('../dist/configCommandes.js', () => ({ ...commandes, compteClaude: async () => ({ connecte: false }), identiteGit: () => ({ nom: 'Fixture', email: 'fixture@example.invalid' }), cheminRaccourci: () => path.join(tmp, 'absent') }));
const comptes = await import('../dist/compteGitHub.js');
mock.module('../dist/compteGitHub.js', () => ({ ...comptes, etatCompteGitHub: async () => ({ ok: true, texte: '@SamChampagneIntebec · connecté' }) }));
const { VueConfig } = await import('./vues/config.tsx');
const { bus } = await import('../dist/ui/bus.js');
const { filtrerConfig } = await import('../dist/ui/useConfig.js');
const { lignesConfig, lireEtatConfig } = await import('../dist/ui/configModele.js');
const ui = await createTestRenderer({ width: 60, height: 28, autoFocus: false, exitOnCtrlC: false });
const root = createRoot(ui.renderer);
let fermetures = 0;
const actions: string[][] = [], lancer = (a: string[]) => actions.push(a);
const dessiner = async () => { await new Promise(r => setTimeout(r, 70)); await ui.flush(); await ui.renderOnce(); };
try {
    bus.on('lancer', lancer);
    root.render(<VueConfig fermer={() => fermetures++} />); await dessiner();
    assert.ok(ui.captureCharFrame().includes('CONFIGURATION'));
    ui.mockInput.typeText('/'); ui.mockInput.typeText('github'); await dessiner();
    for (const largeur of [40, 60, 80, 130]) {
        ui.resize(largeur, 28); await dessiner();
        const ecran = ui.captureCharFrame();
        assert.ok(ecran.includes('Compte GitHub'), `libellé à ${largeur}`);
        assert.ok(ecran.includes('@SamChampagneIntebec'), `valeur lisible à ${largeur}`);
        assert.ok(!ecran.includes('Compte Claude CLI'));
    }
    ui.mockInput.pressEnter(); await dessiner();
    assert.deepEqual(actions.pop(), ['/compte github', '/config']); assert.equal(fermetures, 1);
    ui.mockInput.pressEscape(); await dessiner();
    ui.mockInput.typeText('/'); ui.mockInput.typeText('inexistantq'); await dessiner();
    assert.ok(ui.captureCharFrame().includes('Aucun réglage trouvé')); assert.equal(fermetures, 1, 'q dans une recherche ne ferme pas');
    ui.mockInput.pressEnter(); await dessiner(); assert.equal(actions.length, 0);
    ui.mockInput.pressKey('u', { ctrl: true }); await dessiner();
    assert.ok(!ui.captureCharFrame().includes('Aucun réglage trouvé'), 'Ctrl+U vide la recherche');
    ui.mockInput.pressEscape(); await dessiner(); assert.equal(fermetures, 1);
    ui.mockInput.pressArrow('down'); ui.mockInput.pressEnter(); await dessiner();
    assert.deepEqual(actions.pop(), ['/connexions', '/config'], 'flèche puis Entrée sans attendre un rendu');
    ui.mockInput.pressEscape(); await dessiner(); assert.equal(fermetures, 3);
    const equipes = filtrerConfig(lignesConfig(lireEtatConfig()), 'modeles equipe');
    assert.ok(equipes.some(l => l.type === 'reglage' && l.commande === '/modeles-equipes'));
    console.log('CONFIG_TUI_OK : recherche, accents, détails, clavier rapide, vide et 40/60/80/130 colonnes');
} finally { bus.off('lancer', lancer); await ui.dispose(); fs.rmSync(tmp, { recursive: true, force: true }); }
