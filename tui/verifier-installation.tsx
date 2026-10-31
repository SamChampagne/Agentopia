import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';

// Refus avant l'import de l'application : aucun essai sur le profil personnel.
const profil = process.env.CLAUDETOPIA_DATA_DIR;
const relatif = profil ? path.relative(os.tmpdir(), path.resolve(profil)) : '';
if (process.env.CLAUDETOPIA_TEST_UI !== '1' || !profil || !path.isAbsolute(profil)
    || !relatif || relatif.startsWith('..') || path.isAbsolute(relatif)
    || !fs.statSync(profil, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Vérification refusée : un profil temporaire de test est obligatoire.');
}
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.AGENTOPIA_SANS_MOTEUR = '1';
const { App } = await import('./app.tsx');
const ui = await createTestRenderer({ width: 130, height: 34, autoFocus: false, openConsoleOnError: false });
const root = createRoot(ui.renderer);
const dessiner = async () => { await new Promise((r) => setTimeout(r, 200)); await ui.flush(); await ui.renderOnce(); return ui.captureCharFrame(); };
const originale = console.error, erreurs: unknown[][] = [];
console.error = (...args) => { erreurs.push(args); };
try {
    root.render(<App quitter={() => {}} accueil />);
    assert.match(await dessiner(), /Bonjour/, 'écran d’accueil visible en production');
    ui.mockInput.pressEscape();
    assert.match(await dessiner(), /AGENTOPIA/, 'cockpit visible après l’accueil');
    await ui.mockInput.typeText('Brouillon de verification');
    ui.mockInput.pressKey('j', { ctrl: true });
    await ui.mockInput.typeText('Deuxieme ligne');
    const frame = await dessiner();
    assert.match(frame, /Brouillon de verification/); assert.match(frame, /Deuxieme ligne/);
    assert.equal(erreurs.length, 0, 'aucune erreur de rendu au démarrage');
    // Le garde-fou de la bibliothèque utilisait aussi jsxDEV et masquait le
    // premier défaut par une seconde exception : vérifier son rendu réel.
    const ErreurFixture = (): never => { throw new Error('ERREUR-RENDU-FIXTURE'); };
    root.render(<ErreurFixture />); assert.match(await dessiner(), /ERREUR-RENDU-FIXTURE/); assert.ok(erreurs.length);
    const erreursAttendues = erreurs.length;
    root.render(<App quitter={() => {}} />);
    assert.match(await dessiner(), /AGENTOPIA/, 'rendu rétabli après l’erreur contrôlée');
    assert.equal(erreurs.length, erreursAttendues, 'aucune seconde erreur pendant la reprise');
    process.stdout.write(`Interface Agentopia vérifiée (${process.env.NODE_ENV || 'development'}) : accueil, cockpit, saisie, erreur visible et reprise\n`);
} finally { console.error = originale; root.render(<text>fin</text>); await ui.flush(); await ui.dispose(); }
