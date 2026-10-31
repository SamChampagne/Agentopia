#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { CHEMINS } from './chemins.js';
import { trouverBun } from './runtimeInterface.js';
import { installerDiagnostics } from './diagnostics.js';
installerDiagnostics();

if (process.argv.includes('--verifier-installation')) {
    try { const { verifierInstallation } = await import('./verifierInstallation.js'); await verifierInstallation(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')); }
    catch (e) { console.error((e as Error).message); process.exitCode = 1; }
    process.exit(process.exitCode ?? 0);
}

// Nouvelle interface (OpenTUI, sous Bun) : utilisée dès que Bun et ses dépendances sont là.
// CLAUDETOPIA_INK=1 garde l'ancienne interface (Ink) ; si Bun ne démarre pas, on y revient aussi.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TUI = path.join(RACINE, 'tui', 'app.tsx');
const bun = !process.env.CLAUDETOPIA_INK && fs.existsSync(path.join(RACINE, 'tui', 'node_modules', '@opentui', 'core')) ? trouverBun() : undefined;
if (bun && fs.existsSync(TUI)) {
    const res = spawnSync(bun, ['--jsx-import-source', '@opentui/react', TUI, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' } });
    if (!res.error) process.exit(res.status ?? 0);
    console.error(`Nouvelle interface indisponible (${res.error.message}) : démarrage de l'ancienne.`);
}

// La souris n'arrive dans Node sur Windows qu'à partir de Node 24 (mode console "VT").
// Sur une version plus ancienne, on se relance sous Node 24 (sans toucher au Node du système) :
// directement si on connaît déjà son chemin, sinon via npx (qui le télécharge une fois).
// Si la relance échoue, on démarre quand même avec le Node actuel (sans la souris).
const CHEMIN_NODE24 = CHEMINS.node24;
const majeure = Number(process.versions.node.split('.')[0]);
const script = fileURLToPath(import.meta.url);
const env = { ...process.env, CLAUDETOPIA_NODE24: '1' };
let relance = false;

if (majeure >= 24 && process.env.CLAUDETOPIA_NODE24) {
    // On tourne sous le Node 24 de npx : on retient son chemin pour la prochaine fois
    try {
        fs.writeFileSync(CHEMIN_NODE24, process.execPath, 'utf-8');
    } catch {
        // pas grave : on repassera par npx
    }
}

if (majeure < 24 && process.platform === 'win32' && !process.env.CLAUDETOPIA_NODE24) {
    let node24 = '';
    try {
        node24 = fs.readFileSync(CHEMIN_NODE24, 'utf-8').trim();
    } catch {
        // première fois
    }
    const res = node24 && fs.existsSync(node24)
        ? spawnSync(node24, [script, ...process.argv.slice(2)], { stdio: 'inherit', env })
        : spawnSync('npx', ['-y', 'node@24', `"${script}"`, ...process.argv.slice(2)], { stdio: 'inherit', shell: true, env });
    // 9009 = commande introuvable pour cmd.exe
    if (!res.error && res.status !== 9009) {
        relance = true;
        process.exit(res.status ?? 0);
    }
    console.error(`Relance sous Node 24 impossible (${res.error?.message ?? `code ${res.status}`}) : démarrage sans la souris.`);
}
// React en mode production : le mode développement (par défaut) rend chaque image plusieurs fois plus lentement
process.env.NODE_ENV ??= 'production';
if (!relance) await import('./principal.js');
