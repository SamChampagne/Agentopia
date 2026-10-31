import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { remplacerFichier } from './stockageAtomique.js';

/** Protection contre les liens préexistants ; pas une sandbox contre un processus du même compte. */
export function verifierCheminLocal(cible: string): void {
    const absolu = path.resolve(cible), parent = path.dirname(absolu);
    if (parent !== absolu) verifierCheminLocal(parent);
    try {
        const s = fs.lstatSync(absolu);
        if (s.isSymbolicLink() || s.isFile() && s.nlink !== 1 || !s.isFile() && !s.isDirectory())
            throw new Error('Lien ou fichier spécial refusé. Les données existantes sont conservées.');
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}
export function lireFichierBorne(fichier: string, maximum: number): Buffer {
    verifierCheminLocal(fichier);
    const fd = fs.openSync(fichier, 'r');
    try {
        const s = fs.fstatSync(fd);
        if (!s.isFile() || s.size > maximum || s.nlink !== 1) throw new Error('Fichier invalide ou trop volumineux.');
        const b = Buffer.alloc(s.size + 1); let lus = 0, n = 0;
        while (lus < b.length && (n = fs.readSync(fd, b, lus, b.length - lus, null)) > 0) lus += n;
        if (lus !== s.size) throw new Error('Le fichier a changé pendant sa lecture. Réessaie.');
        return b.subarray(0, lus);
    } finally { fs.closeSync(fd); }
}
export function ecrireFichierAtomique(fichier: string, contenu: string | Buffer): void {
    verifierCheminLocal(fichier); fs.mkdirSync(path.dirname(fichier), { recursive: true });
    const temporaire = `${fichier}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaire, contenu, { flag: 'wx', mode: 0o600 });
        verifierCheminLocal(fichier); remplacerFichier(temporaire, fichier);
    } finally { try { fs.unlinkSync(temporaire); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
}
