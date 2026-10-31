import * as fs from 'node:fs';
import * as path from 'node:path';
import { surPath } from './chemins.js';

// Node ne lance pas directement les .cmd de npm (EINVAL). Utiliser le binaire
// natif que le paquet Bun installe à côté du shim, sans passer par un shell.
export function trouverBun(lanceur = surPath('bun')): string | undefined {
    if (!lanceur || process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(lanceur)) return lanceur;
    const natif = path.join(path.dirname(lanceur), 'node_modules', 'bun', 'bin', 'bun.exe');
    try { if (fs.statSync(natif).isFile()) return natif; } catch { /* Installation npm incomplète. */ }
    return undefined;
}
