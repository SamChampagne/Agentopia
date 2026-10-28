// Test du redimensionnement de la colonne (glisser sa bordure, Alt+←/→). Il enregistre la largeur dans la config :
// la config de l'utilisateur est sauvegardée avant et remise à l'identique après, quoi qu'il arrive.
import * as fs from 'fs';
import { createTestRenderer } from '@opentui/core/testing';
import { createRoot } from '@opentui/react';
import { CHEMINS } from '../dist/chemins.js';

process.env.CLAUDETOPIA_SANS_REPRISE = '1';
const sauvegarde = fs.readFileSync(CHEMINS.config);
const remettre = () => fs.writeFileSync(CHEMINS.config, sauvegarde);
process.on('exit', remettre);

const { App } = await import('./app.tsx');
const { demarrerCollecte } = await import('../dist/ui/donnees.js');
const { capturerConsole } = await import('../dist/ui/journal.js');
demarrerCollecte();
const { renderer, mockInput, mockMouse, flush, captureCharFrame } = await createTestRenderer({ width: 200, height: 50, useMouse: true, autoFocus: false });
capturerConsole();
createRoot(renderer).render(<App quitter={() => undefined} />);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Colonne du « │ » de la colonne sur la ligne des onglets
const bord = () => captureCharFrame().split('\n')[2].indexOf('│');
let ko = 0;
const verifier = (nom: string, vrai: boolean) => {
    if (!vrai) ko++;
    process.stderr.write(`${vrai ? '✓' : '✗'} ${nom}\n`);
};
try {
    await w(5000);
    await flush();
    const x0 = bord();
    await mockMouse.drag(x0, 10, x0 + 12, 10);
    await w(200);
    await flush();
    const x1 = bord();
    verifier(`glisser la bordure élargit la colonne (${x0} → ${x1})`, x1 === x0 + 12);
    const enregistree = JSON.parse(fs.readFileSync(CHEMINS.config, 'utf-8')).largeurLaterale;
    verifier(`largeur enregistrée dans la config (${enregistree})`, enregistree === x1 + 1);
    mockInput.pressArrow('left', { meta: true } as any);
    await w(200);
    await flush();
    verifier(`Alt+← rétrécit de 2 (${x1} → ${bord()})`, bord() === x1 - 2);
} finally {
    remettre();
}
verifier('config remise à l’identique', fs.readFileSync(CHEMINS.config).equals(sauvegarde));
process.exit(ko ? 1 : 0);
