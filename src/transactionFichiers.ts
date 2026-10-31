import * as fs from 'node:fs';
import * as path from 'node:path';
import { sousVerrou } from './verrou.js';
import { ecrireFichierAtomique, lireFichierBorne, verifierCheminLocal } from './fichiersProteges.js';

type Entree = { fichier: string; avant: string | null; apres: string };
type Journal = { format: 'agentopia-transaction-v1'; date: number; terminee: boolean; annulee?: boolean; entrees: Entree[] };
const lire = (f: string) => { try { return lireFichierBorne(f, 32 * 1024 * 1024).toString('base64'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } };
const cle = (f: string) => process.platform === 'win32' ? path.resolve(f).toLowerCase() : path.resolve(f);
function annuler(j: Journal, ecrire = ecrireFichierAtomique): void {
    // Valider l'ensemble avant de toucher au premier fichier. Des changements
    // intervenus depuis l'import doivent être examinés, jamais effacés.
    for (const e of j.entrees) { const actuel = lire(e.fichier); if (actuel !== e.avant && actuel !== e.apres) throw new Error('Un fichier a changé depuis l’import. Copie de récupération conservée ; aucune restauration automatique.'); }
    for (const e of [...j.entrees].reverse()) {
        if (lire(e.fichier) === e.avant) continue;
        verifierCheminLocal(e.fichier);
        if (e.avant === null) fs.unlinkSync(e.fichier); else ecrire(e.fichier, Buffer.from(e.avant, 'base64'));
    }
}
export function appliquerTransaction(journal: string, changements: { fichier: string; contenu: string | Buffer }[], ecrire = ecrireFichierAtomique): void {
    verifierCheminLocal(journal); verifierCheminLocal(`${journal}.verrou`); verifierCheminLocal(`${journal}.verrou/proprietaire.json`);
    sousVerrou(`${journal}.verrou`, () => {
        try {
            const ancienne = JSON.parse(lireFichierBorne(journal, 512 * 1024 * 1024).toString('utf8')) as Journal;
            if (ancienne?.format !== 'agentopia-transaction-v1' || !ancienne.terminee && !ancienne.annulee)
                throw new Error(`Une opération précédente doit être récupérée avant de recommencer : ${journal}`);
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        if (!changements.length || changements.length > 100_000 || new Set(changements.map(e => cle(e.fichier))).size !== changements.length || changements.some(e => cle(e.fichier) === cle(journal))) throw new Error('Transaction invalide');
        const j: Journal = { format: 'agentopia-transaction-v1', date: Date.now(), terminee: false, entrees: changements.map(e => ({ fichier: path.resolve(e.fichier), avant: lire(e.fichier), apres: Buffer.from(e.contenu).toString('base64') })) };
        const texte = JSON.stringify(j); if (Buffer.byteLength(texte) > 512 * 1024 * 1024) throw new Error('Transaction trop volumineuse');
        ecrireFichierAtomique(journal, texte);
        try {
            for (const e of j.entrees) { if (lire(e.fichier) !== e.avant) throw new Error('Un fichier a changé pendant l’import'); ecrire(e.fichier, Buffer.from(e.apres, 'base64')); }
            j.terminee = true; ecrireFichierAtomique(journal, JSON.stringify(j));
        } catch (cause) {
            try { annuler(j); j.annulee = true; ecrireFichierAtomique(journal, JSON.stringify(j)); }
            catch { throw new Error(`Opération interrompue ; récupération nécessaire. Copie conservée : ${journal}`, { cause }); }
            throw new Error('Opération annulée : les fichiers précédents ont été restaurés.', { cause });
        }
    });
}
export function restaurerTransaction(journal: string, fichiersAutorises: string[]): void {
    verifierCheminLocal(`${journal}.verrou`); verifierCheminLocal(`${journal}.verrou/proprietaire.json`);
    sousVerrou(`${journal}.verrou`, () => {
        const j = JSON.parse(lireFichierBorne(journal, 512 * 1024 * 1024).toString('utf8')) as Journal;
        const autorises = new Set(fichiersAutorises.map(cle));
        const valide = (v: unknown) => typeof v === 'string' && v.length <= 48 * 1024 * 1024 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v);
        if (j?.format !== 'agentopia-transaction-v1' || !Array.isArray(j.entrees) || j.entrees.length > 100_000 || j.entrees.some(e => !e || typeof e.fichier !== 'string' || !autorises.has(cle(e.fichier)) || !valide(e.apres) || e.avant !== null && !valide(e.avant)) || new Set(j.entrees.map(e => cle(e.fichier))).size !== j.entrees.length) throw new Error('Journal de récupération invalide');
        annuler(j); j.annulee = true; ecrireFichierAtomique(journal, JSON.stringify(j));
    });
}
