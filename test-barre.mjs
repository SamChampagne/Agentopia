// Vérifie, COULEURS ACTIVÉES (comme dans Windows Terminal), que chaque bouton du haut est dessiné à la colonne
// où le clic l'attend ; puis montre la vue globale en plein écran
process.env.FORCE_COLOR = '3';
process.env.NODE_ENV ??= 'production';
process.env.CLAUDETOPIA_SANS_REPRISE = '1';
const { default: React } = await import('react');
const { render } = await import('ink');
const { EventEmitter } = await import('events');
const { default: stringWidth } = await import('string-width');
const { App, BOUTONS_HAUT } = await import('./dist/ui/App.js');
const { souris } = await import('./dist/ui/terminal.js');
const { placerBoutons } = await import('./dist/ui/mise.js');
const { largeurTitre } = await import('./dist/ui/Zones.js');
(await import('./dist/ui/journal.js')).capturerConsole();
const ecrire = (...a) => process.stderr.write(a.join(' ') + '\n');
const COLS = Number(process.env.COLS ?? 155), ROWS = Number(process.env.ROWS ?? 47);
let image = '';
const faux = Object.assign(new EventEmitter(), { columns: COLS, rows: ROWS, isTTY: true, write: (s) => { image = s; return true; } });
const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {}, read() { return null; }, resume() {}, pause() {} });
render(React.createElement(App), { stdout: faux, stdin, patchConsole: false, exitOnCtrlC: false, debug: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
await w(6000);

// Toute séquence d'échappement doit être bien formée (que des chiffres et des ;)
const mauvaises = image.match(/\x1b\[[0-9;]*[^0-9;A-Za-z][^m]*m/g) ?? [];
ecrire(mauvaises.length ? `✗ ${mauvaises.length} code(s) couleur invalide(s), ex. ${JSON.stringify(mauvaises[0])}` : '✓ tous les codes couleur sont valides');
const ligne0 = image.split('\n')[0].replace(/\x1b\[[0-9;]*m/g, '');
const boutons = placerBoutons(BOUTONS_HAUT, largeurTitre());
let ok = true;
for (const b of boutons) {
    const i = ligne0.indexOf(b.label);
    const colonne = stringWidth(ligne0.slice(0, i));
    if (colonne !== b.x + 1) { ok = false; ecrire(`✗ « ${b.label} » dessiné colonne ${colonne}, attendu ${b.x + 1}`); }
}
if (ok) ecrire(`✓ les ${boutons.length} boutons du haut sont exactement là où le clic les attend`);
ecrire('barre du haut :', ligne0.slice(0, 80));

const live = boutons.find((b) => b.action === '/global');
souris.emit('souris', { x: live.x + 2, y: 0, bouton: 'gauche', appui: true });
souris.emit('souris', { x: live.x + 2, y: 0, bouton: 'gauche', appui: false });
await w(5000);
ecrire(image.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 24).map((l) => l.slice(0, COLS)).join('\n'));
process.exit(0);
