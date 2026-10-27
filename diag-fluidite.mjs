// Mesure de fluidité : rafraîchissements d'écran et retard de la boucle d'événements au repos
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './dist/ui/App.js';
import { capturerConsole } from './dist/ui/journal.js';
import { monitorEventLoopDelay } from 'perf_hooks';
capturerConsole();
const { frames } = render(React.createElement(App));
await new Promise((r) => setTimeout(r, 8000));   // démarrage + chargement initial
const f0 = frames.length, u0 = process.cpuUsage();
const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
await new Promise((r) => setTimeout(r, 20000));
h.disable();
const u = process.cpuUsage(u0);
process.stderr.write(`20 s au repos : ${frames.length - f0} rafraîchissements, CPU ${((u.user + u.system) / 1000).toFixed(0)} ms, retard max ${(h.max / 1e6).toFixed(0)} ms, p99 ${(h.percentile(99) / 1e6).toFixed(0)} ms\n`);
process.exit(0);
