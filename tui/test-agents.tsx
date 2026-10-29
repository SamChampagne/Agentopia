import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'claudetopia-tui-test-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier;
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, maitre: { actif: false }, fetchAuto: false }));
// Imports après l'isolation de la configuration. Aucun collecteur/serveur/agent n'est démarré.
const { Barre } = await import('./barre.tsx');
const { Conversation } = await import('./conversation.tsx');
const { CarteSession } = await import('./vues/live.tsx');
const { VueProjets } = await import('./vues/projets.tsx');
const { Choix } = await import('./dialogues.tsx');
const ui = await createTestRenderer({ width: 120, height: 28, autoFocus: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 60)); await ui.flush(); await ui.renderOnce(); };
let saisies = 0, envois = 0;
const props = { valeur: 'mon brouillon', cle: 0, setValeur: () => { saisies++; }, soumettre: () => { envois++; },
    suggestions: [], indexSugg: 0, choisirSugg() {}, indication: { texte: 'Projets : tape pour filtrer · Échap pour revenir', couleur: '#999999' } };
try {
    root.render(<box flexDirection="column" height={28}><VueProjets fermer={() => {}} /><Barre {...props} actif={false} /></box>);
    await dessiner();
    assert.match(ui.captureCharFrame(), /Brouillon conservé : mon brouillon/);
    await ui.mockInput.typeText('abc'); await dessiner();
    assert.match(ui.captureCharFrame(), /filtre : « abc »/);
    assert.equal(saisies, 0); assert.equal(envois, 0);
    ui.mockInput.pressEscape(); await dessiner();
    assert.doesNotMatch(ui.captureCharFrame(), /filtre : « abc »/);
    root.render(<Barre {...props} actif />); await dessiner();
    ui.mockInput.pressEnter(); await dessiner(); assert.equal(envois, 1);
    let decision: unknown;
    root.render(<Choix hauteur={28} d={{ message: 'Autorisation : Bash', detail: 'Commande proposée : npm test\nDossier : projet-fixture',
        choix: [{ label: 'Refuser', valeur: false }, { label: 'Autoriser une fois', valeur: true }], resoudre: (v: unknown) => { decision = v; } }} />);
    await dessiner();
    assert.match(ui.captureCharFrame(), /Commande proposée : npm test/);
    ui.mockInput.pressEnter(); await dessiner(); assert.equal(decision, false);
    const s = { cle: 'fixture', id: 'fixture', sessionId: 'fixture', arrierePlan: true, integree: true,
        fournisseur: 'codex', nom: 'Projet', titre: 'Vérification', cwd: dossier, debut: new Date(),
        statut: 'bloquee', permission: { id: 'permission', titre: 'npm test', detail: 'fixture' }, fichier: path.join(dossier, 'conversation.jsonl') };
    root.render(<Conversation s={s} largeur={120} agir={() => {}} diff={false} />); await dessiner();
    const conversation = ui.captureCharFrame();
    assert.match(conversation, /codex/); assert.match(conversation, /Répondre à l’agent/);
    assert.match(conversation, /npm test/); assert.doesNotMatch(conversation, /À côté|Rejoindre/);
    for (const statut of ['travaille', 'bloquee']) {
        const carte = { s: { ...s, statut }, a: {}, largeur: 70, choisie: false, survolee: false, agir() {}, survoler() {} };
        root.render(<CarteSession {...carte} tic={0} />); await dessiner();
        const bord = JSON.stringify(ui.captureSpans().lines[0]);
        root.render(<CarteSession {...carte} tic={1} />); await dessiner();
        assert.equal(JSON.stringify(ui.captureSpans().lines[0]), bord, `Bord stable : ${statut}`);
    }
    process.stdout.write('✓ TUI : filtre Projets, brouillon, envoi, permission intégrée, bordures Live stables\n');
} finally { await ui.dispose(); fs.rmSync(dossier, { recursive: true, force: true }); }
