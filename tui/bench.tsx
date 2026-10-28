// Banc du prototype OpenTUI, comparable à bench-image.mjs (Ink) : CPU par action (frappe, molette, clic), au repos,
// et une capture de l'écran pour vérifier le rendu. Lancer : bun tui/bench.tsx
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { App } from './app.tsx';
import { demarrerCollecte } from '../dist/ui/donnees.js';
import { capturerConsole } from '../dist/ui/journal.js';

const COLS = Number(process.env.COLS ?? 220), ROWS = Number(process.env.ROWS ?? 55);
demarrerCollecte();
const { renderer, mockInput, mockMouse, flush, captureCharFrame } = await createTestRenderer({ width: COLS, height: ROWS, useMouse: true, enableMouseMovement: true });
let images = 0;
renderer.postProcessFns?.push?.(() => void images++);
capturerConsole();
createRoot(renderer).render(<App quitter={() => process.exit(0)} />);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
await w(Number(process.env.ATTENTE ?? 9000));
await flush();
if (process.env.CAPTURE) process.stderr.write(captureCharFrame() + '\n');

async function serie(nom: string, action: (i: number) => Promise<void> | void, n = 40) {
    // CPU total de la série (attentes comprises) / n : le compteur Windows avance par pas de ~16 ms
    const delais: number[] = [];
    const u0 = process.cpuUsage();
    for (let i = 0; i < n; i++) {
        const t = performance.now();
        await action(i);
        await flush();
        delais.push(performance.now() - t);
        await w(80);
    }
    const u = process.cpuUsage(u0);
    delais.sort((a, b) => a - b);
    process.stderr.write(`${nom.padEnd(22)} CPU moyen par action ${((u.user + u.system) / 1000 / n).toFixed(1)} ms · jusqu'à l'image : médiane ${delais[n >> 1].toFixed(1)} ms, pire ${delais[n - 1].toFixed(1)} ms\n`);
}

// Frappe : « a » puis effacer (le champ finit vide ; rien n'est jamais envoyé, il n'y a pas d'Entrée)
await mockInput.typeText('zq');
await flush();
const frappeVisible = captureCharFrame().includes('❯ zq');
await mockInput.pressBackspace();
await mockInput.pressBackspace();
await flush();
process.stderr.write(`frappe visible à l'écran : ${frappeVisible ? 'oui' : 'NON'}\n`);
await serie('cockpit (frappe)', (i) => (i % 2 ? mockInput.pressBackspace() : mockInput.typeText('a')));
// Molette sur la liste des projets (défilement natif)
await mockMouse.click(12, 2);
await flush();
await serie('projets (molette)', (i) => mockMouse.scroll(10, 10, i % 2 ? 'up' : 'down'));
// Clic sur une carte de session puis Échap
await mockMouse.click(3, 2);
await flush();
await serie('clic carte (ouvrir)', (i) => (i % 2 ? mockInput.pressEscape() : mockMouse.click(5, 3)));
await mockInput.pressEscape();
if (process.env.CAPTURE) { await flush(); process.stderr.write(captureCharFrame() + '\n'); }
const i0 = images, u0 = process.cpuUsage();
await w(15000);
const u = process.cpuUsage(u0);
process.stderr.write(`repos 15 s              ${images - i0} images · CPU ${((u.user + u.system) / 1000).toFixed(0)} ms\n`);
process.exit(0);
