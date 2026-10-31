import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { sousVerrou } from './verrou.js';
import { lireFichierBorne, ecrireFichierAtomique, verifierCheminLocal } from './fichiersProteges.js';
const ecrireAtomique = (fichier: string, contenu: unknown) => ecrireFichierAtomique(fichier, JSON.stringify(contenu));

export interface RecuPlanification { jour: string; etat: 'attente' | 'reserve' | 'lance' | 'erreur'; message?: string; session?: string }
export type RecusPlanifications = Record<string, RecuPlanification>;
const sauvegarde = `${CHEMINS.planifications}.sauvegarde`;
export function jourPlanification(d = new Date()): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function decoder(texte: string): RecusPlanifications {
    const v = JSON.parse(texte);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Structure des reçus invalide');
    return Object.fromEntries(Object.entries(v).map(([id, valeur]: [string, any]) => {
        const r = typeof valeur === 'string' ? { jour: valeur, etat: 'lance' } : valeur;
        if (!/^[a-z0-9_-]{1,128}$/i.test(id) || !r || typeof r !== 'object' || typeof r.jour !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.jour)
            || !['attente', 'reserve', 'lance', 'erreur'].includes(r.etat) || ['message', 'session'].some((k) => r[k] !== undefined && typeof r[k] !== 'string')) throw new Error('Reçu de planification invalide');
        return [id, r];
    }));
}
function lire(fichier: string): RecusPlanifications {
    return decoder(lireFichierBorne(fichier, 4 * 1024 * 1024).toString('utf8'));
}
export function lireRecusPlanifications(): RecusPlanifications {
    try { return lire(CHEMINS.planifications); }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !fs.existsSync(sauvegarde)) return {};
        throw new Error('Historique des planifications illisible. Aucun lancement autorisé ; fichiers conservés. Utilise /planifications-recuperer.');
    }
}
/** Appelé sous le verrou des reçus : un état abîmé ne devient jamais un historique vide. */
export function ecrireRecusPlanifications(recus: RecusPlanifications): void {
    const precedent = lireRecusPlanifications(); decoder(JSON.stringify(recus));
    ecrireAtomique(sauvegarde, fs.existsSync(CHEMINS.planifications) ? precedent : recus);
    ecrireAtomique(CHEMINS.planifications, recus);
}
export function diagnosticPlanifications(): { erreur?: string; sauvegarde?: number } {
    try { lireRecusPlanifications(); return {}; }
    catch (e) { let date: number | undefined; try { lire(sauvegarde); date = fs.statSync(sauvegarde).mtimeMs; } catch { /* Pas de sauvegarde fiable. */ } return { erreur: (e as Error).message, sauvegarde: date }; }
}
export function recupererRecusPlanifications(ids: string[]): string | undefined {
    verifierCheminLocal(`${CHEMINS.planifications}.verrou`);
    return sousVerrou(`${CHEMINS.planifications}.verrou`, () => {
        if (!diagnosticPlanifications().erreur) return;
        let recus: RecusPlanifications = {}; try { recus = lire(sauvegarde); } catch { /* Récupération conservatrice sans rejouer aujourd'hui. */ }
        for (const id of ids) recus[id] = { jour: jourPlanification(), etat: 'reserve', message: 'Historique récupéré : aucun rejeu automatique aujourd’hui. Vérifie les sessions avant un essai manuel.' };
        decoder(JSON.stringify(recus));
        let copie: string | undefined;
        try { const contenu = lireFichierBorne(CHEMINS.planifications, 4 * 1024 * 1024); copie = `${CHEMINS.planifications}.recup-${Date.now()}-${randomUUID()}`; verifierCheminLocal(copie); fs.writeFileSync(copie, contenu, { flag: 'wx', mode: 0o600 }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        fs.mkdirSync(CHEMINS.moteur, { recursive: true }); ecrireAtomique(path.join(CHEMINS.moteur, 'pause.json'), { date: Date.now() });
        ecrireAtomique(CHEMINS.planifications, recus); return copie;
    });
}
