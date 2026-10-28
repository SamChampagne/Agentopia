process.env.CLAUDETOPIA_SANS_REPRISE = '1';
// Grille, fichiers chauds, diff en direct et écran de veille, sans terminal (rien n'est envoyé ni modifié).
// Lancer : bun tui/test-wow.tsx   (VOIR=1 pour afficher les écrans)
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { App } from './app.tsx';
import { demarrerCollecte, lireDonnees } from '../dist/ui/donnees.js';
import { capturerConsole } from '../dist/ui/journal.js';
import { bus } from '../dist/ui/bus.js';
import { modificationsSession } from '../dist/modifications.js';
import { lignesDiff } from './diffDirect.tsx';

demarrerCollecte();
const { renderer, mockInput, mockMouse, flush, captureCharFrame } = await createTestRenderer({ width: 180, height: 45, useMouse: true, autoFocus: false });
capturerConsole();
createRoot(renderer).render(<App quitter={() => undefined} />);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ecran = async () => (await flush(), await w(200), await flush(), captureCharFrame());
let ok = 0, ko = 0;
function verifier(nom: string, vrai: boolean, image?: string) {
    if (vrai) ok++; else ko++;
    process.stderr.write(`${vrai ? '✓' : '✗'} ${nom}\n`);
    if ((!vrai || process.env.VOIR) && image) process.stderr.write(image.split('\n').slice(0, 45).join('\n') + '\n');
}

// Le diff : lignes communes retirées, une de contexte gardée
const diff = lignesDiff('a\nb\nc\nd', 'a\nb\nX\nd');
verifier('lignesDiff : contexte, −c, +X, contexte', JSON.stringify(diff.map((l) => l.type + l.t)) === '[" b","-c","+X"," d"]');

await w(6000);
const d = lireDonnees();

// Alt+G : la grille
mockInput.pressKey('g', { meta: true });
let image = await ecran();
verifier('Alt+G : grille de conversations', image.includes('en direct · clic pour l’ouvrir') || image.includes('aucune session active'), image);
mockInput.pressKey('g', { meta: true });
image = await ecran();
verifier('Alt+G encore : retour au cockpit', !image.includes('en direct · clic pour l’ouvrir'), image);

// Alt+H : les fichiers chauds
mockInput.pressKey('h', { meta: true });
image = await ecran();
verifier('Alt+H : fichiers chauds', image.includes('♨ FICHIERS CHAUDS'), image);
mockInput.pressEscape();
image = await ecran();
verifier('Échap referme les fichiers chauds', !image.includes('♨ FICHIERS CHAUDS'), image);

// Diff en direct : une session qui a modifié un fichier ces 10 dernières minutes
const recente = d.agents.find((s: any) => {
    const m = modificationsSession(s.fichier).derniere;
    return m && Date.now() - m.date < 10 * 60_000;
});
if (recente) {
    bus.emit('selectionner', recente.sessionId);
    await w(500);
    image = await ecran();
    const fichier = modificationsSession(recente.fichier).derniere.chemin.split(/[\\/]/).pop();
    verifier(`diff en direct sous la conversation (${fichier})`, image.includes(fichier) && /(Edit|Write|MultiEdit) · /.test(image), image);
    mockInput.pressKey('d', { meta: true });
    image = await ecran();
    verifier('Alt+D cache le diff', !/(Edit|Write|MultiEdit) · il y a/.test(image), image);
    mockInput.pressKey('d', { meta: true });
    mockInput.pressEscape();
    await ecran();
} else process.stderr.write('· pas de modification récente : diff en direct non vérifié\n');

// Alt+O : le globe des serveurs (braille) ; son coût en CPU se mesure à part : bun tui/bench-3d.tsx
mockInput.pressKey('o', { meta: true });
image = await ecran();
verifier('Alt+O : globe des serveurs en braille', image.includes('GLOBE DES SERVEURS') && /[⠁-⣿]/.test(image) && image.includes('ton poste'), image);
mockInput.pressEscape();
image = await ecran();
verifier('Échap referme le globe', !image.includes('GLOBE DES SERVEURS'), image);

// L'écran de veille, puis une touche ramène l'interface
bus.emit('veille');
await w(700);
image = await ecran();
verifier('écran de veille : heure et état des sessions', image.includes('une touche ou la souris pour revenir') && /au travail|aucune session active/.test(image), image);
mockInput.pressKey('x');
await w(300);
image = await ecran();
verifier('une touche réveille', !image.includes('une touche ou la souris pour revenir') && image.includes('Sessions  Projets'), image);

process.stderr.write(`\n${ok} réussis · ${ko} échoués\n`);
process.exit(ko ? 1 : 0);
