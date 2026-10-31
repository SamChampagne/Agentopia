import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-github-ui-'));
process.env.CLAUDETOPIA_DATA_DIR = tmp;
process.env.CLAUDETOPIA_TEST_UI = '1'; process.env.CLAUDETOPIA_SANS_REPRISE = '1'; process.env.AGENTOPIA_SANS_MOTEUR = '1';
const { normaliserConfig, sauverConfig, chargerConfig } = await import('../dist/config.js');
const { choisirCompteGitHub } = await import('../dist/compteGitHubCommande.js');
const { bus } = await import('../dist/ui/bus.js');
const { Choix } = await import('./dialogues.tsx');
const { lignesConfig, lireEtatConfig } = await import('../dist/ui/VueConfig.js');
const config = normaliserConfig({ racines: [], extras: [], compteGitHub: 'SamChampagne' }); sauverConfig(config);
const appels: string[] = [];
const services = {
    lister: async () => [{ login: 'SamChampagne', actif: true, valide: true }, { login: 'SamChampagneIntebec', actif: false, valide: true }],
    jeton: async (login: string) => { appels.push(login); return 'fixture'; },
    verifier: async () => 'SamChampagneIntebec', actualiser: async () => { appels.push('actualiser'); },
};
const ui = await createTestRenderer({ width: 130, height: 28, autoFocus: false, exitOnCtrlC: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise(r => setTimeout(r, 80)); await ui.flush(); await ui.renderOnce(); };
const recevoir = (d: any) => { if (d) root.render(<Choix d={d} hauteur={28} />); };
try {
    bus.on('demande', recevoir);
    const selection = choisirCompteGitHub(config, services);
    for (const largeur of [60, 80, 130]) {
        ui.resize(largeur, 28); await dessiner();
        const ecran = ui.captureCharFrame();
        for (const texte of ['Compte GitHub pour Agentopia', '@SamChampagne', '@SamChampagneIntebec', 'SSH', 'Échap']) assert.ok(ecran.includes(texte), `${texte} visible à ${largeur} colonnes`);
        assert.equal(appels.length, 0, 'aucune connexion avant validation');
    }
    ui.mockInput.pressArrow('down'); ui.mockInput.pressEnter(); await selection;
    assert.deepEqual(appels, ['SamChampagneIntebec', 'actualiser']); assert.equal(chargerConfig().compteGitHub, 'SamChampagneIntebec');
    const lignes = lignesConfig(lireEtatConfig());
    assert.ok(lignes.some(l => l.type === 'reglage' && l.label === 'Compte GitHub' && l.valeur.includes('SamChampagneIntebec') && l.commande === '/compte github'));
    const annulation = assert.rejects(choisirCompteGitHub(config, services), { name: 'Annule' });
    await dessiner(); ui.mockInput.pressEscape(); await annulation;
    assert.equal(chargerConfig().compteGitHub, 'SamChampagneIntebec'); assert.equal(appels.length, 2);
    console.log('GITHUB_UI_OK : deux comptes, clavier, annulation, préférence visible et 60/80/130 colonnes');
} finally {
    bus.off('demande', recevoir); await ui.dispose(); fs.rmSync(tmp, { recursive: true, force: true });
}
