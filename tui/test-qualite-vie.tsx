import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-qol-tui-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier;
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.CLAUDETOPIA_TEST_UI = '1';
fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ banniere: 'CLAUDETOPIA', racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
const { App } = await import('./app.tsx');
const { lireDonnees } = await import('../dist/ui/donnees.js');
const { bus } = await import('../dist/ui/bus.js');
const { CarnetBrouillons, destinationBrouillon } = await import('../dist/ui/brouillons.js');
const { CHEMINS } = await import('../dist/chemins.js');
const { COMMANDES } = await import('../dist/commandes.js');
const { VueProjets } = await import('../dist/ui/VueProjets.js');
const ReactInk = await import('../node_modules/react/index.js');
const d = lireDonnees();
for (const id of ['session-a', 'session-b']) {
    const fichier = path.join(dossier, `${id}.jsonl`); fs.writeFileSync(fichier, '');
    d.agents.push({ cle: id, id, sessionId: id, integree: true, arrierePlan: true, fournisseur: 'codex', cwd: dossier,
        nom: 'Projet fixture', titre: id, debut: new Date(), statut: 'attend', fichier } as any);
}
const graines = new CarnetBrouillons();
graines.ecrire(destinationBrouillon('session-a'), { images: [path.join(dossier, 'capture.png')] }); graines.sauver();
const ui = await createTestRenderer({ width: 130, height: 34, autoFocus: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 100)); await ui.flush(); await ui.renderOnce(); };
const choisir = async (id: string) => { bus.emit('selectionner', id); await dessiner(); await dessiner(); };
try {
    root.render(<App quitter={() => {}} />); await dessiner();
    assert.match(ui.captureCharFrame(), /AGENTOPIA/);
    assert.doesNotMatch(ui.captureCharFrame(), /CLAUDETOPIA/);
    const mission = COMMANDES.find((c: any) => c.nom === 'mission')!.executer({ args: [], reste: '', apresProjet: '', projet: { nom: 'Fixture', chemin: dossier } as any });
    const missionAnnulee = Promise.resolve(mission).catch((e) => { assert.equal(e.constructor.name, 'Annule'); });
    await dessiner();
    assert.match(ui.captureCharFrame(), /Corriger un bug/);
    assert.match(ui.captureCharFrame(), /Ajouter une fonction/);
    assert.match(ui.captureCharFrame(), /Analyser le projet/);
    ui.mockInput.pressEscape(); await dessiner(); await missionAnnulee;
    // Le choix du fournisseur se fait dans l'interface, sans ouvrir de session réelle.
    bus.emit('lancer', '/agent-defaut'); await dessiner();
    assert.match(ui.captureCharFrame(), /Agent des nouvelles conversations/);
    assert.match(ui.captureCharFrame(), /Codex/); assert.match(ui.captureCharFrame(), /Perplexity/);
    ui.mockInput.pressArrow('down'); await dessiner();
    ui.mockInput.pressArrow('down'); await dessiner();
    ui.mockInput.pressEnter(); await dessiner();
    assert.equal(JSON.parse(fs.readFileSync(CHEMINS.config, 'utf8')).fournisseurDefaut, 'codex');
    bus.emit('notice', ''); await dessiner();
    assert.match(ui.captureCharFrame(), /nouvelle conversation · Codex/);
    await choisir('session-a');
    await ui.mockInput.typeText('brouillon alpha'); await dessiner();
    assert.match(ui.captureCharFrame(), /brouillon alpha/); assert.match(ui.captureCharFrame(), /1 pièce/);
    await choisir('session-b');
    assert.doesNotMatch(ui.captureCharFrame(), /brouillon alpha|1 pièce/);
    await ui.mockInput.typeText('brouillon beta'); await dessiner();
    assert.match(ui.captureCharFrame(), /brouillon beta/);
    ui.mockInput.pressKey('f', { ctrl: true }); await dessiner();
    await ui.mockInput.typeText('mot-recherche'); await dessiner();
    ui.mockInput.pressEscape(); await dessiner();
    assert.match(ui.captureCharFrame(), /brouillon beta/); assert.doesNotMatch(ui.captureCharFrame(), /mot-recherche/);
    await choisir('session-a');
    assert.match(ui.captureCharFrame(), /brouillon alpha/); assert.match(ui.captureCharFrame(), /1 pièce/);
    // Le dialogue Projets prend le clavier ; aucune lettre ne va dans le brouillon.
    bus.emit('demande', { type: 'vue', rendu: (fermer: () => void) => ReactInk.createElement(VueProjets, { fermer }), resoudre: () => bus.emit('demande', undefined) });
    await dessiner(); await ui.mockInput.typeText('filtre'); await dessiner();
    bus.emit('demande', undefined); await dessiner();
    assert.match(ui.captureCharFrame(), /brouillon alpha/);
    // Un échec retardé doit restaurer A, même si B est devenue la conversation active.
    const commandeEnvoi = COMMANDES.find((c: any) => c.nom === 'envoyer')!;
    const ancienEnvoi = commandeEnvoi.executer;
    let echouer!: (e: Error) => void;
    commandeEnvoi.executer = () => new Promise((_ok, ko) => { echouer = ko; });
    try {
        ui.mockInput.pressEnter(); await dessiner();
        await choisir('session-b');
        await ui.mockInput.typeText(' suite'); await dessiner();
        echouer(new Error('Envoi fixture refusé')); await dessiner();
        assert.match(ui.captureCharFrame(), /brouillon beta suite/);
        await choisir('session-a');
        bus.emit('notice', ''); await dessiner();
        assert.match(ui.captureCharFrame(), /brouillon alpha/); assert.match(ui.captureCharFrame(), /1 pièce/);
    } finally { commandeEnvoi.executer = ancienEnvoi; }
    root.render(<text>fermé</text>); await dessiner();
    const relu = new CarnetBrouillons(CHEMINS.brouillons);
    assert.equal(relu.lire(destinationBrouillon('session-a')).texte, 'brouillon alpha');
    assert.equal(relu.lire(destinationBrouillon('session-b')).texte, 'brouillon beta suite');
    delete process.env.CLAUDETOPIA_SANS_REPRISE;
    fs.writeFileSync(CHEMINS.etat, JSON.stringify({ session: 'session-b' }));
    root.render(<App quitter={() => {}} />); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /brouillon beta suite/);
    d.agents[0].statut = 'erreur' as any; d.agents[0].issue = 'error';
    await choisir('session-a');
    assert.match(ui.captureCharFrame(), /Reprendre/);
    assert.match(ui.captureCharFrame(), /Reconnecter/);
    assert.match(ui.captureCharFrame(), /Bilan/);
    process.stdout.write('✓ TUI : deux conversations, pièces jointes isolées, recherche, vue Projets et reprise après fermeture\n');
} finally {
    root.render(<text>fin</text>); await dessiner(); await ui.dispose();
    fs.rmSync(dossier, { recursive: true, force: true });
}
