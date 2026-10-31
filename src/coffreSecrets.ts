import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { sousVerrou } from './verrou.js';
import { verifierCheminLocal, lireFichierBorne, ecrireFichierAtomique } from './fichiersProteges.js';

export type ContenuCoffre = Record<string, string>;
export class CoffreSecrets {
    readonly sauvegarde: string;
    constructor(readonly fichier: string, private operations = { lire: lireFichierBorne, ecrire: ecrireFichierAtomique }) { this.sauvegarde = `${fichier}.sauvegarde.json`; }
    private decoder(b: Buffer): ContenuCoffre {
        let v: unknown; try { v = JSON.parse(b.toString('utf8')); } catch { throw new Error('Coffre illisible. Aucun secret modifié. /recuperer-coffre pour les options.'); }
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.entries(v).some(([k, x]) => !k || k.length > 1024 || typeof x !== 'string' || x.length > 128 * 1024 || !x || ['__proto__', 'constructor', 'prototype'].includes(k)))
            throw new Error('Format du coffre invalide. Aucun secret modifié.');
        return Object.assign(Object.create(null), v);
    }
    lire(fichier = this.fichier): ContenuCoffre {
        try { return this.decoder(this.operations.lire(fichier, 4 * 1024 * 1024)); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' && fichier === this.fichier) return Object.create(null); throw e; }
    }
    modifier(fn: (v: ContenuCoffre) => void): void {
        verifierCheminLocal(this.fichier); verifierCheminLocal(`${this.fichier}.verrou`);
        verifierCheminLocal(`${this.fichier}.verrou/proprietaire.json`);
        sousVerrou(`${this.fichier}.verrou`, () => {
            const actuel = this.lire(), avant = JSON.stringify(actuel, null, 2); fn(actuel);
            const apres = JSON.stringify(actuel, null, 2); this.decoder(Buffer.from(apres));
            if (avant === apres) return;
            this.operations.ecrire(this.sauvegarde, fs.existsSync(this.fichier) ? avant : apres);
            this.operations.ecrire(this.fichier, apres);
        });
    }
    restaurer(): string | undefined {
        verifierCheminLocal(`${this.fichier}.verrou`); verifierCheminLocal(`${this.fichier}.verrou/proprietaire.json`);
        return sousVerrou(`${this.fichier}.verrou`, () => {
            const valide = this.lire(this.sauvegarde); let copie: string | undefined;
            try {
                const original = lireFichierBorne(this.fichier, 4 * 1024 * 1024);
                copie = `${this.fichier}.avant-recuperation-${randomUUID()}.json`;
                fs.writeFileSync(copie, original, { flag: 'wx', mode: 0o600 });
            } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
            ecrireFichierAtomique(this.fichier, JSON.stringify(valide, null, 2)); return copie;
        });
    }
}
