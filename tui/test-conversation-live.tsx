import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'agentopia-live-tui-'));
process.env.CLAUDETOPIA_DATA_DIR = dossier;
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.CLAUDETOPIA_TEST_UI = '1';
fs.writeFileSync(path.join(dossier, 'claudetopia.json'), JSON.stringify({ racines: [], extras: [], notifications: false, fetchAuto: false, maitre: { actif: false } }));
const { App } = await import('./app.tsx');
const { Conversation } = await import('./conversation.tsx');
const { lireDonnees } = await import('../dist/ui/donnees.js');
const { bus } = await import('../dist/ui/bus.js');
const { changerDisposition } = await import('../dist/ui/disposition.js');
const { config, COMMANDES } = await import('../dist/commandes.js');
const { creerIntegree, ajouterEvenement, ajouterMessage, dossierIntegre } = await import('../dist/sessionsIntegrees.js');
const s = creerIntegree('codex', dossier, 'Conversation fixture');
ajouterMessage(s.id, 'user', 'Vérifie le projet');
ajouterEvenement(s.id, 'tour', { id: 'cmd', role: 'outil', texte: 'Commande', commande: 'npm test', etat: 'en_cours', sortie: 'ligne cachée\n1\n2\n3' });
const fichier = path.join(dossierIntegre(s.id), 'conversation.jsonl');
const session: any = { cle: s.id, id: s.id, sessionId: s.id, integree: true, arrierePlan: true, fournisseur: 'codex', cwd: dossier,
    nom: 'Projet fixture', titre: 'Session', debut: new Date(), statut: 'attend', fichier };
const d = lireDonnees(); d.agents.push(session);
const ui = await createTestRenderer({ width: 130, height: 34, autoFocus: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 110)); await ui.flush(); await ui.renderOnce(); };
try {
    root.render(<box height={34}><Conversation s={session} largeur={130} agir={() => {}} diff={false} /></box>); await dessiner();
    let frame = ui.captureCharFrame();
    assert.match(frame, /Ouvrir Codex/); assert.match(frame, /Codex à côté/); assert.match(frame, /Détails des outils/);
    assert.match(frame, /npm test/); assert.match(frame, /en cours/); assert.doesNotMatch(frame, /ligne cachée/);
    assert.ok(frame.split('\n').filter((l) => l[23] === '│').length > 15, 'séparation verticale continue');
    ui.mockInput.pressKey('l', { meta: true }); await dessiner();
    assert.match(ui.captureCharFrame(), /ligne cachée/);
    ajouterEvenement(s.id, 'tour', { id: 'cmd', role: 'outil', texte: 'Commande', commande: 'npm test', etat: 'termine', sortie: 'tests réussis', codeSortie: 0 });
    await new Promise((r) => setTimeout(r, 250)); await dessiner();
    assert.match(ui.captureCharFrame(), /tests réussis/); assert.doesNotMatch(ui.captureCharFrame(), /en cours/);
    ajouterMessage(s.id, 'assistant', Array.from({ length: 70 }, (_, i) => `Longue conversation · ligne ${i + 1}`).join('\n'));
    root.render(<App quitter={() => {}} />); await dessiner();
    bus.emit('selectionner', s.id); await dessiner(); await dessiner();
    await ui.mockInput.typeText('brouillon conservé'); await dessiner();
    assert.match(ui.captureCharFrame(), /brouillon conservé/);
    assert.match(ui.captureCharFrame(), /Longue conversation · ligne 70/);
    ui.mockInput.pressKey('\x1b[5~'); await dessiner();
    assert.doesNotMatch(ui.captureCharFrame(), /Longue conversation · ligne 70/);
    assert.match(ui.captureCharFrame(), /Derniers messages/);
    assert.match(ui.captureCharFrame(), /brouillon conservé/);
    // Un nouveau message ne déplace pas une lecture dans l'historique.
    ajouterMessage(s.id, 'assistant', 'Dernière réponse en direct');
    await new Promise((r) => setTimeout(r, 250)); await dessiner();
    assert.doesNotMatch(ui.captureCharFrame(), /Dernière réponse en direct/);
    ui.mockInput.pressKey('END', { meta: true }); await dessiner();
    assert.match(ui.captureCharFrame(), /Dernière réponse en direct/);
    assert.doesNotMatch(ui.captureCharFrame(), /Derniers messages/);
    ui.mockInput.pressKey('HOME', { meta: true }); await dessiner();
    assert.match(ui.captureCharFrame(), /Vérifie le projet/);
    ui.mockInput.pressKey('\x1b[6~'); await dessiner();
    assert.doesNotMatch(ui.captureCharFrame(), /Vérifie le projet/);
    // Le clic sur le statut retrouve le direct, avec le même comportement que Alt+Fin.
    await ui.mockMouse.click(85, 3); await dessiner();
    assert.match(ui.captureCharFrame(), /Dernière réponse en direct/);
    ui.mockInput.pressKey('f', { ctrl: true }); await dessiner();
    await ui.mockInput.typeText('ligne 3'); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /1\/11/);
    ui.mockInput.pressArrow('up'); await dessiner();
    assert.match(ui.captureCharFrame(), /2\/11/);
    ui.mockInput.pressArrow('down'); await dessiner();
    assert.match(ui.captureCharFrame(), /1\/11/);
    ui.mockInput.pressEscape(); await dessiner();
    assert.match(ui.captureCharFrame(), /brouillon conservé/);
    const autre = creerIntegree('codex', dossier, 'Seconde conversation');
    ajouterMessage(autre.id, 'assistant', 'Conversation indépendante');
    d.agents.push({ ...session, cle: autre.id, id: autre.id, sessionId: autre.id, fichier: path.join(dossierIntegre(autre.id), 'conversation.jsonl') });
    bus.emit('selectionner', autre.id); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /Conversation indépendante/);
    assert.doesNotMatch(ui.captureCharFrame(), /Longue conversation|brouillon conservé/);
    bus.emit('selectionner', s.id); await dessiner(); await dessiner();
    assert.match(ui.captureCharFrame(), /Dernière réponse en direct/);
    assert.match(ui.captureCharFrame(), /brouillon conservé/);
    session.terminalExterne = true; session.statut = 'travaille'; bus.emit('notice', 'Terminal ouvert'); await dessiner();
    frame = ui.captureCharFrame(); assert.match(frame, /Lecture seule : cette conversation/);
    assert.doesNotMatch(frame, /[▁▂▃▄▅▆▇█]/);
    await ui.mockInput.typeText('NE PAS INSERER'); ui.mockInput.pressEnter(); await dessiner();
    session.terminalExterne = undefined; session.statut = 'attend'; bus.emit('notice', 'Terminal fermé'); await dessiner();
    assert.match(ui.captureCharFrame(), /brouillon conservé/); assert.doesNotMatch(ui.captureCharFrame(), /NE PAS INSERER/);
    // La saisie reste dans les limites du chat, même si les deux colonnes changent de côté.
    for (const largeur of [100, 130, 192]) {
        ui.resize(largeur, 34); await dessiner();
        for (const [laterale, actions] of [['gauche', 'gauche'], ['droite', 'gauche'], ['gauche', 'droite'], ['cachee', 'haut'], ['cachee', 'cachees']] as const) {
            changerDisposition({ laterale, actions }, config); await dessiner(); await dessiner();
            const lignes = ui.captureCharFrame().split('\n');
            const cadres = lignes.filter((l) => l.includes('╭'));
            assert.equal(cadres.length, 1, 'une seule barre de saisie');
            const lateral = Math.max(32, Math.min(56, Math.floor(largeur / 3)));
            const gauche = (laterale === 'gauche' ? lateral : 0) + (actions === 'gauche' ? 24 : 0) + 1;
            const droite = largeur - (laterale === 'droite' ? lateral : 0) - (actions === 'droite' ? 24 : 0) - 2;
            assert.equal(cadres[0].indexOf('╭'), gauche, `${largeur}/${laterale}/${actions} : bord gauche du chat`);
            assert.equal(cadres[0].indexOf('╮'), droite, `${largeur}/${laterale}/${actions} : bord droit du chat`);
            assert.match(lignes[33], /╰.*╯/, 'champ fixé au bas du chat malgré un long historique');
            assert.match(lignes[32], /brouillon conservé/);
        }
    }
    changerDisposition({ laterale: 'gauche', actions: 'gauche' }, config); await dessiner();
    const commande = COMMANDES.find((c: any) => c.nom === 'envoyer')!;
    const avant = commande.executer; const envois: string[][] = [];
    try {
        commande.executer = async (ctx: any) => { envois.push(ctx.args); };
        ui.mockInput.pressEnter(); ui.mockInput.pressEnter(); await dessiner(); await dessiner();
        assert.equal(envois.length, 1); assert.equal(envois[0][0], s.id);
        assert.match(envois[0].slice(1).join(' '), /brouillon conservé/);
    } finally { commande.executer = avant; }
    ui.mockInput.pressEscape(); await dessiner(); await dessiner();
    assert.equal(ui.captureCharFrame().split('\n')[31].indexOf('╭'), 0, 'saisie générale retrouvée au cockpit');
    process.stdout.write('✓ TUI : suivi Codex, terminal exclusif, saisie dans le chat (100/130/192 colonnes), brouillon et envoi unique\n');
} finally { await ui.dispose(); fs.rmSync(dossier, { recursive: true, force: true }); }
