#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { CHEMINS } from './chemins.js';

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
