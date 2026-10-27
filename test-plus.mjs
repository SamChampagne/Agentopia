// Test des améliorations dans l'interface : palette, questions, recherche Ctrl+F, coût dans la barre d'état
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './dist/ui/App.js';
import { souris } from './dist/ui/terminal.js';
import { capturerConsole } from './dist/ui/journal.js';
capturerConsole();
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const brut = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const { stdin, lastFrame } = render(React.createElement(App));
const ecran = (titre, debut = 0, fin = 34, de = 0, a = 100) => process.stderr.write(`\n===== ${titre}\n${brut(lastFrame()).split('\n').slice(debut, fin).map((l) => l.slice(de, a)).join('\n')}\n`);
const taper = async (t) => { for (const ch of t) { stdin.write(ch); await w(12); } await w(300); };
await w(12000);
ecran('Barre d\'état (coût du jour)', 33, 34);

stdin.write('\x0b');   // Ctrl+K
await w(800);
await taper('sani com');
ecran('Palette Ctrl+K, « sani com »', 2, 16, 33);
stdin.write('\x1b');
await w(600);

souris.emit('souris', { x: 5, y: 2, bouton: 'gauche', appui: true });
souris.emit('souris', { x: 5, y: 2, bouton: 'gauche', appui: false });
await w(1500);
ecran('Questions (clic sur l\'en-tête « en attente »)', 2, 22, 33);
stdin.write('\x1b');
await w(600);

// Ouvre la 1re carte puis Ctrl+F « claude »
// 3e carte (la session CLI, qui a une longue conversation)
souris.emit('souris', { x: 5, y: 2 + 1 + 8 + 1, bouton: 'gauche', appui: true });
souris.emit('souris', { x: 5, y: 2 + 1 + 8 + 1, bouton: 'gauche', appui: false });
await w(2500);
stdin.write('\x06');   // Ctrl+F
await w(300);
await taper('claude');
await w(800);
ecran('Ctrl+F « claude » dans la conversation', 2, 34, 33);
process.exit(0);
