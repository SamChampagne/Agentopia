// Coût d'une image : temps CPU par rafraîchissement d'écran (moins sensible à la charge du poste que les délais)
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.NODE_ENV ??= 'production';
const { default: React } = await import('react');
const { render } = await import('ink');
import { EventEmitter } from 'events';
const { App } = await import('./dist/ui/App.js');
import { souris } from './dist/ui/terminal.js';
import { sortieVers } from './dist/ui/sortie.js';
import { capturerConsole } from './dist/ui/journal.js';
import { calculerMise } from './dist/ui/mise.js';
capturerConsole();
const COLS = Number(process.env.COLS ?? 220), ROWS = Number(process.env.ROWS ?? 55);
let ecritures = 0, recent = '';
const faux = Object.assign(new EventEmitter(), { columns: COLS, rows: ROWS, isTTY: true, write: (t) => { ecritures++; recent = (recent + t).slice(-20000); return true; } });
let tampon = [];
const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {}, read() { return tampon.shift() ?? null; }, resume() {}, pause() {} });
const taper = (t) => { tampon.push(t); stdin.emit('readable'); };
render(React.createElement(App), { stdout: sortieVers(faux), stdin, patchConsole: false, exitOnCtrlC: false });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
await w(Number(process.env.ATTENTE ?? 9000));
const m = calculerMise(COLS, ROWS);

// Une série d'images provoquées une par une ; on garde la médiane du CPU par image
async function serie(nom, action, n = 40) {
    // CPU total de la série (attentes comprises) / n : le compteur Windows avance par pas de ~16 ms
    const delais = [];
    const u0 = process.cpuUsage();
    for (let i = 0; i < n; i++) {
        const avant = ecritures;
        const t = performance.now();
        action(i);
        while (ecritures === avant && performance.now() - t < 1000) await w(1);
        delais.push(performance.now() - t);
        await w(80);   // fin de l'animation éventuelle
    }
    const u = process.cpuUsage(u0);
    delais.sort((a, b) => a - b);
    process.stderr.write(`${nom.padEnd(22)} CPU moyen par action ${((u.user + u.system) / 1000 / n).toFixed(1)} ms · jusqu'à l'image : médiane ${delais[n >> 1].toFixed(1)} ms, pire ${delais[n - 1].toFixed(1)} ms\n`);
}

// Nombre pair : chaque « a » est effacé, le champ finit vide. Pas de Ctrl+U : l'interface le lit comme « u »,
// et « u/sorties » + Entrée partirait à Claude comme une nouvelle session
await serie('cockpit (frappe)', (i) => taper(i % 2 ? '\x7f' : 'a'));
for (let i = 0; i < 2000; i++) console.log(`ligne ${i} \x1b[36mavec couleur\x1b[0m et un texte assez long pour remplir la zone principale ${'·'.repeat(i % 80)}`);
await w(1000);
recent = '';
taper('/sorties');
await w(300);
// Garde-fou : Entrée seulement si le champ contient exactement /sorties (sinon ce serait une demande envoyée à Claude)
if (!/❯ \/sorties(\s|$)/m.test(recent.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))) {
    process.stderr.write('✕ le champ de saisie ne contient pas exactement /sorties : arrêt, rien n\'est envoyé\n');
    process.exit(1);
}
taper('\r');
await w(1500);
await serie('journal (molette)', (i) => souris.emit('souris', { x: m.lateral + 20, y: 20, bouton: i % 2 ? 'molette-bas' : 'molette-haut', appui: true }));
// Au repos : CPU et nombre d'images sur 15 s
taper('\x1b');
await w(1000);
const e0 = ecritures, u0 = process.cpuUsage();
await w(15000);
const u = process.cpuUsage(u0);
process.stderr.write(`repos 15 s              ${ecritures - e0} images · CPU ${((u.user + u.system) / 1000).toFixed(0)} ms\n`);
process.exit(0);
