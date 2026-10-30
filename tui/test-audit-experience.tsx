import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-audit-experience-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier;
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.CLAUDETOPIA_TEST_UI = '1';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.PERPLEXITY_API_KEY;
fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { fournisseur: 'claude', actif: false } }));
const { App } = await import('./app.tsx');
const { bus } = await import('../dist/ui/bus.js');
const { lireDonnees } = await import('../dist/ui/donnees.js');
const { CarnetBrouillons, destinationBrouillon } = await import('../dist/ui/brouillons.js');
const { config, COMMANDES } = await import('../dist/commandes.js');
const { changerDisposition } = await import('../dist/ui/disposition.js');
const { etatMaitre } = await import('../dist/maitre.js');
const image = path.join(dossier, 'capture.png'), preuve = path.join(dossier, 'preuve.txt'), absent = path.join(dossier, 'absent.png');
fs.writeFileSync(image, 'fixture'); fs.writeFileSync(preuve, 'fixture');
const d = lireDonnees();
for (const [id, fournisseur] of [['a', 'codex'], ['b', 'perplexity'], ['c', 'codex']]) {
    const fichier = path.join(dossier, `${id}.jsonl`);
    fs.writeFileSync(fichier, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Historique de démonstration' }] } }) + '\n');
    d.agents.push({ cle: id, id, sessionId: id, integree: true, arrierePlan: true, fournisseur, cwd: dossier,
        nom: `Projet ${id}`, titre: 'Session', debut: new Date(), statut: 'attend', fichier } as any);
}
const graines = new CarnetBrouillons();
graines.ecrire(destinationBrouillon('a'), { texte: 'Décris [image 1] et [fichier 2: preuve.txt]', images: [image, preuve] });
graines.ecrire(destinationBrouillon('b'), { texte: 'Recherche [image 1]', images: [image] });
graines.ecrire(destinationBrouillon('c'), { texte: 'Fichier disparu [image 1]', images: [absent] }); graines.sauver();
const ui = await createTestRenderer({ width: 130, height: 34, autoFocus: false, exitOnCtrlC: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 230)); await ui.flush(); await ui.renderOnce(); };
const choisir = async (id: string) => { bus.emit('selectionner', id); await dessiner(); };
const commande = COMMANDES.find((c: any) => c.nom === 'envoyer')!;
const avant = commande.executer, envoyes: string[] = [];
commande.executer = async (ctx: any) => { envoyes.push(ctx.reste); };
try {
    root.render(<App quitter={() => {}} />); await dessiner(); await choisir('a');
    assert.match(ui.captureCharFrame(), /2 pièce\(s\) jointe/);
    await ui.mockMouse.click(85, 29); await dessiner();
    assert.match(ui.captureCharFrame(), /Pièces jointes du brouillon/);
    ui.mockInput.pressEnter(); await dessiner();
    assert.match(ui.captureCharFrame(), /1 pièce\(s\) jointe/);
    assert.match(ui.captureCharFrame(), /\[fichier 1: preuve.txt\]/);
    assert.doesNotMatch(ui.captureCharFrame(), /\[image 1\]/);
    ui.mockInput.pressEnter(); await dessiner();
    assert.equal(envoyes.length, 1); assert.ok(envoyes[0].includes(preuve)); assert.ok(!envoyes[0].includes(image));
    await choisir('b'); ui.mockInput.pressEnter(); await dessiner();
    assert.equal(envoyes.length, 1, 'Perplexity refuse la pièce jointe sans perdre le message');
    ui.mockInput.pressKey('i', { meta: true }); await dessiner();
    assert.match(ui.captureCharFrame(), /Pièces jointes du brouillon/);
    ui.mockInput.pressEscape(); await dessiner();
    assert.match(ui.captureCharFrame(), /Recherche \[image 1\]/);
    ui.mockInput.pressKey('i', { meta: true }); await dessiner(); ui.mockInput.pressArrow('down'); ui.mockInput.pressEnter(); await dessiner();
    assert.doesNotMatch(ui.captureCharFrame(), /1 pièce\(s\) jointe/);
    assert.match(ui.captureCharFrame(), /Recherche/);
    ui.mockInput.pressEnter(); await dessiner();
    assert.equal(envoyes.length, 2); assert.ok(!envoyes[1].includes('Pièces jointes'));
    await choisir('c'); ui.mockInput.pressEnter(); await dessiner();
    assert.equal(envoyes.length, 2, 'un fichier disparu ne part pas au fournisseur');
    assert.match(ui.captureCharFrame(), /inaccessible/); assert.match(ui.captureCharFrame(), /Fichier disparu/);
    ui.mockInput.pressKey('i', { meta: true }); await dessiner(); ui.mockInput.pressEnter(); await dessiner();
    // Le maître échoue localement avant tout réseau car ce profil n'a aucune clé Anthropic.
    ui.mockInput.pressKey('m', { meta: true }); await dessiner();
    await ui.mockInput.typeText('Brouillon maître à conserver'); ui.mockInput.pressEnter(); await dessiner();
    assert.match(etatMaitre().historique.at(-1)?.erreur ?? '', /clé API Anthropic/);
    assert.match(ui.captureCharFrame().split('\n')[32], /Brouillon maître à conserver/);
    ui.mockInput.pressEscape(); await dessiner();
    assert.match(ui.captureCharFrame(), /Fichier disparu/);
    changerDisposition({ laterale: 'droite', actions: 'droite' }, config); await dessiner();
    const preferences = JSON.stringify(config.ecran);
    for (const [largeur, hauteur] of [[60, 18], [80, 24]]) {
        ui.resize(largeur, hauteur); await dessiner();
        bus.emit('notice', 'Une longue indication qui ne doit pas masquer le champ. '.repeat(10)); await dessiner();
        const lignes = ui.captureCharFrame().split('\n');
        assert.equal(lignes[hauteur - 1].indexOf('╰'), 1, `${largeur} : champ fixé au bas du chat`);
        assert.equal(lignes[hauteur - 1].indexOf('╯'), largeur - 2);
        assert.match(lignes[hauteur - 2], /Fichier disparu/);
        assert.match(ui.captureCharFrame(), /Actions · Alt\+A/);
        assert.match(ui.captureCharFrame(), /Outils · Alt\+L/);
        ui.mockInput.pressKey('l', { meta: true }); await dessiner();
        assert.match(ui.captureCharFrame(), /Résumer · Alt\+L/);
        ui.mockInput.pressKey('l', { meta: true }); await dessiner();
        ui.mockInput.pressKey('a', { meta: true }); await dessiner();
        assert.match(ui.captureCharFrame(), /Ouvrir Codex/);
        ui.mockInput.pressEscape(); await dessiner();
        const sessionsX = ui.captureCharFrame().split('\n')[0].indexOf('Sessions');
        assert.ok(sessionsX > 0); await ui.mockMouse.click(sessionsX + 2, 0); await dessiner();
        assert.match(ui.captureCharFrame(), /Sessions ouvertes/); ui.mockInput.pressEscape(); await dessiner();
        assert.equal(JSON.stringify(config.ecran), preferences);
    }
    ui.resize(140, 34); await dessiner();
    const lignes = ui.captureCharFrame().split('\n');
    assert.equal(lignes[33].indexOf('╰'), 1); assert.equal(lignes[33].indexOf('╯'), 68);
    assert.doesNotMatch(ui.captureCharFrame(), /Actions · Alt\+A/);
    assert.equal(JSON.stringify(config.ecran), preferences, 'préférences restaurées à l’élargissement');
    root.render(<text>fermé</text>); await dessiner();
    assert.equal(new CarnetBrouillons().lire(destinationBrouillon('c', true)).texte, 'Brouillon maître à conserver');
    process.stdout.write('✓ TUI audit : pièces jointes retirables, refus sans perte, maître restauré, compact 60/80 puis retour 140 colonnes\n');
} finally {
    commande.executer = avant; root.render(<text>fin</text>); await dessiner(); await ui.dispose();
    const relatif = path.relative(os.tmpdir(), dossier);
    if (relatif && !relatif.startsWith('..') && !path.isAbsolute(relatif)) fs.rmSync(dossier, { recursive: true, force: true });
}
