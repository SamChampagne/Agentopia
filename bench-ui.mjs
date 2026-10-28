// Mesure de réactivité en plein écran : délai entre un événement (clic, molette) et l'écriture à l'écran
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.NODE_ENV ??= 'production';
const { default: React } = await import('react');
const { render } = await import('ink');
import { EventEmitter } from 'events';
const { App } = await import('./dist/ui/App.js');
import { souris, injecter } from './dist/ui/terminal.js';
import { sortieVers } from './dist/ui/sortie.js';
import { capturerConsole } from './dist/ui/journal.js';
import { calculerMise } from './dist/ui/mise.js';
capturerConsole();
const COLS = Number(process.env.COLS ?? 220), ROWS = Number(process.env.ROWS ?? 55);
const ecritures = [];
const faux = Object.assign(new EventEmitter(), { columns: COLS, rows: ROWS, isTTY: true, write: (s) => { ecritures.push({ t: performance.now(), n: s.length }); return true; } });
const ecran = sortieVers ? sortieVers(faux) : faux;
let tampon = [];
const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {}, read() { return tampon.shift() ?? null; }, resume() {}, pause() {} });
const taper = (t) => { tampon.push(t); stdin.emit('readable'); };
render(React.createElement(App), { stdout: ecran, stdin, patchConsole: false, exitOnCtrlC: false });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
await w(Number(process.env.ATTENTE ?? 7000));
// Un long journal, pour que la molette ait quelque chose à faire défiler
for (let i = 0; i < 2000; i++) console.log(`ligne ${i} [36mavec couleur[0m et un texte assez long pour remplir la largeur de la zone principale ${'·'.repeat(i % 80)}`);
await w(1500);
// L'accueil est le cockpit : on ouvre le journal complet, sinon la molette n'a rien à faire défiler
taper('/sorties');
await w(300);
taper('\r');
await w(1500);
const m = calculerMise(COLS, ROWS);
async function mesurer(nom, action, n = 10) {
    const delais = []; let octets = 0;
    for (let i = 0; i < n; i++) {
        const avant = ecritures.length; const t = performance.now();
        action(i);
        while (ecritures.length === avant && performance.now() - t < 1000) await w(1);
        delais.push(ecritures.length > avant ? ecritures[avant].t - t : 1000);
        await w(60);
        octets += ecritures.slice(avant).reduce((s, e) => s + e.n, 0);
    }
    delais.sort((a, b) => a - b);
    process.stderr.write(`${nom.padEnd(26)} médiane ${delais[n >> 1].toFixed(0)} ms · pire ${delais[n - 1].toFixed(0)} ms · ${(octets / n / 1024).toFixed(0)} Ko écrits par action
`);
}
const clic = (x, y) => { souris.emit('souris', { x, y, bouton: 'gauche', appui: true }); souris.emit('souris', { x, y, bouton: 'gauche', appui: false }); };
await mesurer('molette journal', (i) => souris.emit('souris', { x: m.lateral + 20, y: 20, bouton: i % 2 ? 'molette-bas' : 'molette-haut', appui: true }));
await mesurer('clic carte (ouvrir/fermer)', () => clic(5, 4));
await mesurer('frappe clavier', () => taper('a'));
// Rafale de molette (comme un vrai défilement rapide)
const t = performance.now(); const avant = ecritures.length;
const lagDebut = performance.now();
// Par le vrai décodeur (séquences SGR du terminal), qui regroupe les crans
for (let i = 0; i < 60; i++) { injecter(`[<64;${m.lateral + 21};21M`); await w(5); }
await w(300);
const ec = ecritures.slice(avant);
process.stderr.write(`rafale 60 crans en 300 ms   ${ec.length} écritures, ${(ec.reduce((s, e) => s + e.n, 0) / 1024).toFixed(0)} Ko, fin ${(ec.at(-1).t - t).toFixed(0)} ms
`);
process.exit(0);
