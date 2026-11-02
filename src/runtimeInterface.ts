import * as fs from 'node:fs';
import * as path from 'node:path';
import { surPath } from './chemins.js';

// Bun 1.3.14 charge le tsconfig depuis son cwd initial. L'amorçage démarre dans
// tui/ puis restaure le dossier appelant avant d'importer les modules de l'app.
// --tsconfig-override provoque un diagnostic interne, même pour un simple -e.
// Référence amont : https://github.com/oven-sh/bun/issues/25730
export function lancementInterface(racine: string, argumentsProgramme: string[] = [], env: NodeJS.ProcessEnv = process.env, dossier = process.cwd()) {
    return {
        args: [path.join(racine, 'tui', 'lancer.ts'), ...argumentsProgramme],
        cwd: path.join(racine, 'tui'),
        env: { ...env, NODE_ENV: env.NODE_ENV ?? 'production', AGENTOPIA_DOSSIER_DEMARRAGE: dossier },
    };
}

// Node ne lance pas directement les .cmd de npm (EINVAL). Utiliser le binaire
// natif que le paquet Bun installe à côté du shim, sans passer par un shell.
export function trouverBun(lanceur = surPath('bun')): string | undefined {
    if (!lanceur || process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(lanceur)) return lanceur;
    const natif = path.join(path.dirname(lanceur), 'node_modules', 'bun', 'bin', 'bun.exe');
    try { if (fs.statSync(natif).isFile()) return natif; } catch { /* Installation npm incomplète. */ }
    return undefined;
}
