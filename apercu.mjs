// Aperçu de l'écran à une taille donnée : COLS=115 ROWS=48 node apercu.mjs
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
process.env.NODE_ENV ??= 'production';
const { default: React } = await import('react');
const { render } = await import('ink');
const { EventEmitter } = await import('events');
const { App } = await import('./dist/ui/App.js');
const { sortieVers } = await import('./dist/ui/sortie.js');
(await import('./dist/ui/journal.js')).capturerConsole();
const COLS = Number(process.env.COLS ?? 115), ROWS = Number(process.env.ROWS ?? 48);
let image = '';
const faux = Object.assign(new EventEmitter(), { columns: COLS, rows: ROWS, isTTY: true, write: (s) => { image = s; return true; } });
const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {}, read() { return null; }, resume() {}, pause() {} });
// Sans la sortie optimisée : on veut l'image complète
render(React.createElement(App), { stdout: faux, stdin, patchConsole: false, exitOnCtrlC: false, debug: true });
await new Promise((r) => setTimeout(r, Number(process.env.ATTENTE ?? 7000)));
process.stderr.write(image.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n').map((l) => l.slice(0, Number(process.env.LARGEUR ?? COLS))).join('\n') + '\n');
process.exit(0);
