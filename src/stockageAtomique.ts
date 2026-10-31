import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Windows peut garder brièvement un fichier ouvert pendant sa lecture ou son analyse. */
export function remplacerFichier(temporaire: string, fichier: string, operations = {
    windows: process.platform === 'win32',
    renommer: fs.renameSync,
    patienter: (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
}): void {
    for (let tentative = 0; ; tentative++) {
        try { operations.renommer(temporaire, fichier); return; }
        catch (e) {
            if (!operations.windows || !['EPERM', 'EACCES', 'EBUSY'].includes((e as NodeJS.ErrnoException).code || '') || tentative >= 9) throw e;
            operations.patienter(Math.min(10 * 2 ** tentative, 100));
        }
    }
}
export function ecrireAtomique(fichier: string, valeur: unknown): void {
    const temporaire = `${fichier}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaire, JSON.stringify(valeur), { mode: 0o600 });
        // Ne jamais supprimer la destination pour contourner un refus de renommage.
        remplacerFichier(temporaire, fichier);
    } finally {
        try { fs.rmSync(temporaire, { force: true }); } catch { /* Ne pas masquer une erreur d'écriture avec celle du nettoyage. */ }
    }
}
