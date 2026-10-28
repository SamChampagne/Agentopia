process.env.CLAUDETOPIA_SANS_REPRISE = '1';
// Écran d'accueil animé : il s'affiche au lancement, puis une touche ramène le cockpit. Lancer : bun tui/test-accueil.tsx
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { App } from './app.tsx';
import { demarrerCollecte } from '../dist/ui/donnees.js';

demarrerCollecte();
const { renderer, mockInput, flush, captureCharFrame } = await createTestRenderer({ width: 140, height: 30, useMouse: true, autoFocus: false });
createRoot(renderer).render(<App quitter={() => undefined} accueil />);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ecran = async () => (await flush(), await w(150), await flush(), captureCharFrame());
await w(1500);
let image = await ecran();
// L'anneau 3D : ses caractères d'ombrage, au-dessus de la bannière
const accueil = image.includes('Bonjour') && image.includes('une touche ou un clic') && /[$#@]{2,}/.test(image);
process.stderr.write(`${accueil ? '✓' : '✗'} écran d'accueil\n${process.env.VOIR ? image : ''}`);
mockInput.pressKey('x');
await w(300);
image = await ecran();
const cockpit = image.includes('Sessions  Projets') && !image.includes('une touche ou un clic');
process.stderr.write(`${cockpit ? '✓' : '✗'} une touche ramène le cockpit\n`);
process.exit(accueil && cockpit ? 0 : 1);
