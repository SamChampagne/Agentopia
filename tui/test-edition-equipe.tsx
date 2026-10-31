import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-edition-tui-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier;
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.CLAUDETOPIA_TEST_UI = '1';
process.env.AGENTOPIA_SANS_MOTEUR = '1';
fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
const { App } = await import('./app.tsx');
const { lireDonnees } = await import('../dist/ui/donnees.js');
const { bus, choisir, choisirPlusieurs, saisir } = await import('../dist/ui/bus.js');
const { CHEMINS } = await import('../dist/chemins.js');
const eq = await import('../dist/equipe.js');
const { recetteEquipe } = await import('../dist/equipesGuidees.js');
const e: any = { id: 'edition', mixte: true, projet: dossier, nomProjet: 'Fixture', objectif: 'Objectif initial', etat: 'plan', creee: Date.now(),
    taches: recetteEquipe('duo', 'claude', 'codex').map((t: any, i: number) => ({ ...t, id: `t${i + 1}`, etat: 'attente', role: 'dev' })) };
const sauver = () => { fs.writeFileSync(CHEMINS.equipes, JSON.stringify([e])); eq.rechargerEquipes(); lireDonnees().equipes = eq.lireEquipes(); };
sauver();
const ui = await createTestRenderer({ width: 130, height: 36, autoFocus: false }); const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 120)); await ui.flush(); await ui.renderOnce(); };
let choixCourant: { type: string; choix: { label: string }[] } | undefined;
const recevoirChoix = (d: any) => { choixCourant = d?.type === 'choix' ? d : undefined; };
bus.on('demande', recevoirChoix);
const choisirLibelle = async (libelle: RegExp) => {
    assert.ok(choixCourant, 'un menu de choix est ouvert');
    const index = choixCourant.choix.findIndex(c => libelle.test(c.label));
    assert.ok(index >= 0, `action disponible : ${libelle}`);
    // Le menu peut recevoir de nouvelles actions : partir du début puis naviguer
    // au vrai libellé, sans résoudre le dialogue directement depuis le test.
    for (let i = 0; i < choixCourant.choix.length; i++) ui.mockInput.pressArrow('up');
    for (let i = 0; i < index; i++) ui.mockInput.pressArrow('down');
    await dessiner(); ui.mockInput.pressEnter(); await dessiner();
};
try {
    root.render(<App quitter={() => {}} />); await dessiner();
    bus.emit('lancer', '/equipe-actions edition'); await dessiner();
    assert.match(ui.captureCharFrame(), /Modifier le plan/);
    await choisirLibelle(/Modifier le plan/);
    assert.match(ui.captureCharFrame(), /Enregistrer les modifications/);
    await choisirLibelle(/Modifier l’objectif/); assert.match(ui.captureCharFrame(), /Objectif de l’équipe/);
    ui.mockInput.pressKey('\u001b[F'); await ui.mockInput.typeText(' et tests'); ui.mockInput.pressEnter(); await dessiner();
    await choisirLibelle(/Enregistrer les modifications/); await dessiner();
    const enregistre = JSON.parse(fs.readFileSync(CHEMINS.equipes, 'utf8'))[0];
    assert.equal(enregistre.objectif, 'Objectif initial et tests'); assert.equal(enregistre.etat, 'plan');
    assert.ok(enregistre.taches.every((t: any) => !t.agentId));
    // Une intégration interrompue doit proposer la reprise et son bilan dans le même écran.
    ui.mockInput.pressEscape(); await dessiner(); root.render(<text>transition</text>); await dessiner();
    e.etat = 'prete'; e.taches.forEach((t: any) => { t.etat = 'faite'; t.branche = 'branche-fixture'; });
    e.integrateur = { id: 'integration', titre: 'Intégration', role: 'integrateur', fournisseur: 'claude', agentId: 'fixture-integrateur', etat: 'erreur', consigne: '', dependances: [], resultat: 'Fusion interrompue' };
    sauver(); root.render(<App quitter={() => {}} />); await dessiner(); bus.emit('lancer', '/equipe edition'); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /Reprendre l’intégration/);
    ui.mockInput.pressKey('a'); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /Reprendre integration/);
    assert.doesNotMatch(ui.captureCharFrame(), /Modifier le plan/);
    ui.mockInput.pressEscape(); await dessiner();
    const filtre = choisir('Filtrer puis valider rapidement', [{ label: 'Alpha', valeur: 'a' }, { label: 'Beta', valeur: 'b' }], true);
    await dessiner(); await ui.mockInput.typeText('bet'); ui.mockInput.pressEnter(); await dessiner(); assert.equal(await filtre, 'b');
    const cases = choisirPlusieurs('Cocher puis valider rapidement', [{ label: 'A', valeur: 'a' }, { label: 'B', valeur: 'b', coche: true }]);
    await dessiner(); ui.mockInput.pressKey(' '); ui.mockInput.pressEnter(); await dessiner(); assert.deepEqual(await cases, ['a', 'b']);
    const masque = saisir('Saisie masquée fixture', '', true);
    await dessiner(); await ui.mockInput.typeText('valeur-fixture'); ui.mockInput.pressEnter(); await dessiner(); assert.equal(await masque, 'valeur-fixture');
    const premiere = saisir('Même question', 'première'); await dessiner(); ui.mockInput.pressEnter();
    assert.equal(await premiere, 'première');
    const seconde = saisir('Même question', 'seconde'); await dessiner(); ui.mockInput.pressEnter(); assert.equal(await seconde, 'seconde');
    process.stdout.write('✓ TUI : édition, reprise d’intégration, navigation et saisie rapides, filtres et cases indépendants entre dialogues\n');
} finally {
    bus.off('demande', recevoirChoix);
    root.render(<text>fin</text>); await dessiner(); await ui.dispose();
    const rel = path.relative(os.tmpdir(), dossier); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(dossier, { recursive: true, force: true });
}
