import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-ux-avancee-tui-'));
process.env.CLAUDETOPIA_DATA_DIR = tmp; process.env.CLAUDETOPIA_TEST_UI = '1'; process.env.CLAUDETOPIA_SANS_REPRISE = '1'; process.env.AGENTOPIA_SANS_MOTEUR = '1';
const projets = Array.from({ length: 30 }, (_, i) => { const p = path.join(tmp, `Projet-${String(i).padStart(2, '0')}`); fs.mkdirSync(p); return p; });
fs.writeFileSync(path.join(tmp, 'claudetopia.json'), JSON.stringify({ racines: [], extras: projets, notifications: false, fetchAuto: false }));
const lanceurs = await import('../dist/lanceurs.js'), executions: { commande: string; cwd: string }[] = [];
mock.module('../dist/lanceurs.js', () => ({ ...lanceurs, executer: async (commande: string, cwd: string) => { executions.push({ commande, cwd }); return 0; } }));
const { App } = await import('./app.tsx');
const { VueProjets } = await import('./vues/projets.tsx');
const { bus } = await import('../dist/ui/bus.js');
const { COMMANDES, config, rafraichirProjets } = await import('../dist/commandes.js');
const { lireDonnees } = await import('../dist/ui/donnees.js');
const { lireSynchro } = await import('../dist/synchro.js');
const { CarnetBrouillons, destinationBrouillon } = await import('../dist/ui/brouillons.js');
const fichier = path.join(tmp, 'conversation.jsonl');
const message = (texte: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: texte }] } }) + '\n';
fs.writeFileSync(fichier, message('PREUVE-ANCIENNE-UX') + JSON.stringify({ type: 'system', contenu: 'x'.repeat(2_100_000) }) + '\n' + message('Réponse récente'));
const d = lireDonnees();
for (const id of ['a', 'b']) d.agents.push({ cle: id, id, sessionId: id, integree: true, arrierePlan: true, fournisseur: 'codex', cwd: projets[id === 'a' ? 0 : 1],
    nom: `Projet ${id}`, titre: `Chat ${id}`, debut: new Date(), statut: 'attend', fichier } as any);
const envoyer = COMMANDES.find((c: any) => c.nom === 'envoyer')!, initialEnvoyer = envoyer.executer, envoyes: string[] = [];
envoyer.executer = async (ctx: any) => { envoyes.push(ctx.reste); };
const ui = await createTestRenderer({ width: 130, height: 32, autoFocus: false, exitOnCtrlC: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 180)); await ui.flush(); await ui.renderOnce(); };
const choisir = async (id: string) => { bus.emit('selectionner', id); await dessiner(); };
try {
    root.render(<App quitter={() => {}} />); await dessiner(); await choisir('a');
    const texte = 'def exemple():\n    return 42\n\n# fin';
    await ui.mockInput.pasteBracketedText(texte); await dessiner();
    assert.match(ui.captureCharFrame(), /return 42/);
    await choisir('b'); await choisir('a'); assert.match(ui.captureCharFrame(), /return 42/);
    ui.mockInput.pressEnter(); await dessiner(); assert.equal(envoyes.length, 1); assert.equal(envoyes[0], `a ${texte}`);
    await ui.mockInput.typeText('Ligne un'); ui.mockInput.pressKey('j', { ctrl: true }); await ui.mockInput.typeText('Ligne deux'); await dessiner();
    assert.match(ui.captureCharFrame(), /Ligne deux/); ui.mockInput.pressEnter(); await dessiner(); assert.equal(envoyes[1], 'a Ligne un\nLigne deux');
    await ui.mockInput.typeText('!Write-Output fixture'); ui.mockInput.pressEnter(); await dessiner();
    assert.equal(executions.length, 1); assert.equal(executions[0].cwd, projets[0]);
    await choisir('a'); await ui.mockInput.typeText('Brouillon à garder'); ui.mockInput.pressKey('f', { ctrl: true }); await dessiner();
    await ui.mockInput.typeText('PREUVE-ANCIENNE'); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /1 message\(s\) dans tout l’historique/); assert.match(ui.captureCharFrame(), /PREUVE-ANCIENNE-UX/);
    ui.mockInput.pressEscape(); await dessiner(); assert.match(ui.captureCharFrame(), /Brouillon à garder/);
    await ui.mockInput.pressKeys(['\x1b[5;5~']); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /Début de l’historique/); assert.match(ui.captureCharFrame(), /PREUVE-ANCIENNE-UX/);
    const nouveau = path.join(tmp, 'Ajoute-maintenant'); fs.mkdirSync(nouveau); config.extras.unshift(nouveau); rafraichirProjets();
    ui.mockInput.pressKey('p', { meta: true }); await dessiner(); assert.match(ui.captureCharFrame(), /Ajoute-maintenant/, 'la colonne reçoit les projets sans remonter App');
    root.render(<text>transition</text>); await dessiner();
    assert.equal(new CarnetBrouillons().lire(destinationBrouillon('a')).texte, 'Brouillon à garder');
    config.extras = config.extras.filter(p => p !== nouveau); rafraichirProjets();
    root.render(<VueProjets filtreInitial="Ajoute-maintenant" fermer={() => {}} />); await dessiner();
    assert.match(ui.captureCharFrame(), /0 projet\(s\)/);
    config.extras.unshift(nouveau); rafraichirProjets(); await dessiner(); assert.match(ui.captureCharFrame(), /1 projet\(s\)/, 'vue déjà ouverte actualisée');
    config.extras = config.extras.filter(p => p !== nouveau); rafraichirProjets(); root.render(<text>transition</text>); await dessiner();
    for (const [largeur, hauteur] of [[130, 16], [60, 18], [80, 24]]) {
        ui.resize(largeur, hauteur); let ouverte = ''; const recevoir = (c: string) => { ouverte = c; }; bus.on('lancer', recevoir);
        root.render(<VueProjets key={largeur} fermer={() => {}} />); await dessiner();
        for (let i = 0; i < 24; i++) { ui.mockInput.pressArrow('down'); await dessiner(); }
        assert.match(ui.captureCharFrame(), /Projet-24/, `${largeur}: sélection visible`);
        ui.mockInput.pressEnter(); await dessiner(); assert.match(ouverte, /Projet-24/);
        if (largeur < 110) assert.match(ui.captureCharFrame(), /sans branche/);
        bus.off('lancer', recevoir); root.render(<text>transition</text>); await dessiner();
    }
    process.stdout.write('✓ UX TUI : collage multiligne, Ctrl+J, brouillons, shell dans le chat, recherche ancienne, pages et projets 60/80/130 colonnes\n');
} finally {
    envoyer.executer = initialEnvoyer; root.render(<text>fin</text>); await dessiner(); await ui.dispose(); mock.restore();
    const r = path.relative(os.tmpdir(), tmp); if (r && !r.startsWith('..') && !path.isAbsolute(r)) fs.rmSync(tmp, { recursive: true, force: true });
}
