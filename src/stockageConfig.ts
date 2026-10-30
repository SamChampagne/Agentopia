import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface RecuperationConfig {
    message: string;
    sauvegarde?: string;
    copie?: string;
}

// Stockage distinct des réglages métier : une migration ou une erreur de disque
// ne doivent jamais être confondues avec une configuration vide.
export class StockageConfig<T> {
    readonly sauvegarde: string;
    etat?: RecuperationConfig;
    private copieConservee?: { texte: string; fichier: string };
    constructor(readonly fichier: string, private normaliser: (valeur: unknown) => T, private defaut: () => T) {
        this.sauvegarde = `${fichier}.sauvegarde.json`;
    }
    private decoder(texte: string): T { return this.normaliser(JSON.parse(texte)); }
    private ecrire(fichier: string, texte: string): void {
        const temporaire = `${fichier}.${process.pid}.${randomUUID()}.tmp`;
        fs.mkdirSync(path.dirname(fichier), { recursive: true });
        try {
            fs.writeFileSync(temporaire, texte, { encoding: 'utf8', mode: 0o600 });
            for (let essai = 0; ; essai++) {
                try { fs.renameSync(temporaire, fichier); break; }
                catch (e) {
                    if (!['EPERM', 'EACCES', 'EBUSY'].includes((e as NodeJS.ErrnoException).code ?? '') || essai === 5) throw e;
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 2 ** essai);
                }
            }
        } finally { fs.rmSync(temporaire, { force: true }); }
    }
    private preserver(texte: string): string {
        if (this.copieConservee?.texte === texte && fs.existsSync(this.copieConservee.fichier)) return this.copieConservee.fichier;
        const copie = `${this.fichier}.illisible-${Date.now()}-${randomUUID()}.json`;
        fs.writeFileSync(copie, texte, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        this.copieConservee = { texte, fichier: copie };
        return copie;
    }
    sauver(valeur: T): void {
        const texte = JSON.stringify(this.normaliser(valeur), null, 2);
        let avant: string | undefined;
        try { avant = fs.readFileSync(this.fichier, 'utf8'); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        if (avant === texte) return;
        if (avant !== undefined) {
            let valide = true;
            try { this.decoder(avant); } catch { valide = false; }
            if (valide) this.ecrire(this.sauvegarde, avant);
            else {
                // Si cette copie échoue, l'original reste intact et la sauvegarde
                // précédente n'est jamais remplacée par des données illisibles.
                const copie = this.preserver(avant);
                this.etat = { ...this.etat, message: this.etat?.message ?? 'Configuration illisible préservée avant modification.', copie };
            }
        } else if (!fs.existsSync(this.sauvegarde)) this.ecrire(this.sauvegarde, texte);
        this.ecrire(this.fichier, texte);
    }
    charger(): T {
        let texte: string | undefined, valeur: T;
        try {
            texte = fs.readFileSync(this.fichier, 'utf8');
            valeur = this.decoder(texte);
        } catch (e) {
            const nouveau = texte === undefined && (e as NodeJS.ErrnoException).code === 'ENOENT';
            let secours = false;
            try { valeur = this.decoder(fs.readFileSync(this.sauvegarde, 'utf8')); secours = true; }
            catch { valeur = this.defaut(); }
            if (!nouveau || secours) this.etat = {
                message: secours ? 'Configuration récupérée depuis la dernière sauvegarde valide.' : 'Configuration illisible : réglages par défaut utilisés, original conservé.',
                sauvegarde: secours ? this.sauvegarde : undefined,
            };
            try { this.sauver(valeur); }
            catch {
                this.etat = { ...this.etat, message: 'Configuration non enregistrée : données existantes conservées, réglages disponibles en mémoire.' };
            }
            return valeur;
        }
        // Une migration qui ne peut pas être enregistrée reste utilisable en
        // mémoire ; elle ne repasse jamais par les valeurs par défaut.
        if (JSON.stringify(JSON.parse(texte)) !== JSON.stringify(valeur)) {
            try { this.sauver(valeur); }
            catch { this.etat = { message: 'Mise à niveau des réglages non enregistrée : configuration actuelle conservée.' }; }
        }
        return valeur;
    }
}
