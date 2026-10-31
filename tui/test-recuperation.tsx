import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-recuperation-tui-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier;
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.CLAUDETOPIA_TEST_UI = '1';
process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
const fichier = path.join(dossier, 'claudetopia-equipes.json');
const original = '{fichier abîmé'; fs.writeFileSync(fichier, original);
fs.writeFileSync(`${fichier}.sauvegarde`, JSON.stringify([{ id: 'a-recuperer', projet: dossier, nomProjet: 'Projet conservé', objectif: 'Mission conservée', etat: 'plan', creee: Date.now(), taches: [] }]));
const { App } = await import('./app.tsx');
const { lireDonnees } = await import('../dist/ui/donnees.js');
const { bus } = await import('../dist/ui/bus.js');
const eq = await import('../dist/equipe.js');
const ui = await createTestRenderer({ width: 100, height: 30, autoFocus: false }); const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 150)); await ui.flush(); await ui.renderOnce(); };
try {
    root.render(<App quitter={() => {}} />); await dessiner();
    bus.emit('lancer', '/equipe'); await dessiner();
    assert.match(ui.captureCharFrame(), /illisible ou invalide/); assert.match(ui.captureCharFrame(), /Récupérer les équipes/);
    ui.mockInput.pressEnter(); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /Restaurer la sauvegarde/); assert.match(ui.captureCharFrame(), /mettre en pause/);
    assert.match(ui.captureCharFrame(), /seront interrompues/);
    ui.mockInput.pressEscape(); await dessiner(); assert.equal(fs.readFileSync(fichier, 'utf8'), original);
    bus.emit('lancer', '/equipes-recuperer'); await dessiner();
    ui.mockInput.pressArrow('down'); await dessiner(); ui.mockInput.pressEnter(); await dessiner(); await dessiner();
    assert.equal(eq.erreurStockageEquipes(), undefined); assert.equal(eq.lireEquipes()[0].nomProjet, 'Projet conservé');
    assert.ok(fs.existsSync(path.join(dossier, 'claudetopia-moteur', 'pause.json')));
    const copie = fs.readdirSync(dossier).find((n) => n.includes('.recup-'))!;
    assert.equal(fs.readFileSync(path.join(dossier, copie), 'utf8'), original);
    // Le mode de test ne lance pas la collecte périodique : publier l'état restauré.
    lireDonnees().equipes = eq.lireEquipes(); lireDonnees().erreurEquipes = undefined;
    ui.mockInput.pressEscape(); await dessiner(); bus.emit('lancer', '/equipe'); await dessiner();
    assert.match(ui.captureCharFrame(), /Projet conservé/); assert.doesNotMatch(ui.captureCharFrame(), /illisible ou invalide/);
    process.stdout.write('✓ TUI : fichier abîmé au démarrage, annulation, restauration au clavier, original conservé et pause\n');
} finally {
    root.render(<text>fin</text>); await dessiner(); await ui.dispose();
    const rel = path.relative(os.tmpdir(), dossier); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(dossier, { recursive: true, force: true });
}
