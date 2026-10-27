// Test des espaces de travail, du panneau de détail, de « Quelle touche ? », du survol et de la vue globale,
// à une taille d'écran réelle (COLS × ROWS)
process.env.NODE_ENV ??= 'production';
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
const { default: React } = await import('react');
const { render } = await import('ink');
const { EventEmitter } = await import('events');
const { App } = await import('./dist/ui/App.js');
const { souris } = await import('./dist/ui/terminal.js');
const { calculerMise } = await import('./dist/ui/mise.js');
const { ongletsPositions } = await import('./dist/ui/espaces.js');
(await import('./dist/ui/journal.js')).capturerConsole();
const COLS = Number(process.env.COLS ?? 155), ROWS = Number(process.env.ROWS ?? 47);
let image = '';
const faux = Object.assign(new EventEmitter(), { columns: COLS, rows: ROWS, isTTY: true, write: (s) => { image = s; return true; } });
let tampon = [];
const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {}, read() { return tampon.shift() ?? null; }, resume() {}, pause() {} });
const taper = (t) => { tampon.push(t); stdin.emit('readable'); };
render(React.createElement(App), { stdout: faux, stdin, patchConsole: false, exitOnCtrlC: false, debug: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const brut = () => image.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n');
const voir = (titre, de = 0, a = ROWS, x0 = 0, x1 = COLS) => process.stderr.write(`\n===== ${titre}\n${brut().slice(de, a).map((l) => l.slice(x0, x1)).join('\n')}\n`);
const clic = async (x, y, ms = 1200) => { souris.emit('souris', { x, y, bouton: 'gauche', appui: true }); souris.emit('souris', { x, y, bouton: 'gauche', appui: false }); await w(ms); };
const m = calculerMise(COLS, ROWS);
const onglet = (cle) => ongletsPositions().find((o) => o.cle === cle);

await w(8000);
voir('Accueil : onglets, sessions', 0, 14, 0, 60);
await clic(onglet('projets').x + 1, 2);
voir('Onglet Projets', 2, 14, 0, 60);
await clic(5, 2 + 2);   // 1er projet
voir('Panneau de détail du 1er projet', 2, 22, m.lateral - 2, COLS);
taper('\x1b');
await w(500);
await clic(onglet('serveurs').x + 1, 2, 9000);
voir('Onglet SSH (relevés des serveurs)', 2, 14, 0, 60);
await clic(onglet('docker').x + 1, 2);
voir('Onglet Docker', 2, 12, 0, 60);
await clic(onglet('sessions').x + 1, 2);
taper(' ');
await w(500);
voir('Espace : « Quelle touche ? »', ROWS - 14, ROWS, m.lateral - 2, COLS);
taper('g');
await w(400);
voir('… puis g : Git', ROWS - 10, ROWS, m.lateral - 2, COLS);
taper('\x1b');
await w(400);
// Survol d'une carte : son fond change (vérifié par le texte ANSI : on regarde juste qu'aucune erreur ne survient)
souris.emit('souris', { x: 5, y: 3, bouton: 'gauche', appui: false, survol: true });
await w(300);
const lv = (await import('./dist/ui/App.js')).BOUTONS_HAUT.findIndex((b) => b.action === '/global');
const { placerBoutons } = await import('./dist/ui/mise.js');
const { largeurTitre } = await import('./dist/ui/Zones.js');
const haut = placerBoutons((await import('./dist/ui/App.js')).BOUTONS_HAUT, largeurTitre());
await clic(haut[lv].x + 2, 0, 9000);
voir('Vue globale (live)', 0, 30, m.lateral - 2, COLS);
process.exit(0);
