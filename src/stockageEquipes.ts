import * as fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { ecrireAtomique } from './sessionsIntegrees.js';
import type { Equipe, Tache } from './equipe.js';

export const SAUVEGARDE_EQUIPES = `${CHEMINS.equipes}.sauvegarde`;
const objet = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
function tacheValide(t: any): t is Tache {
    return objet(t) && ['id', 'titre', 'role', 'consigne'].every((k) => typeof t[k] === 'string')
        && Array.isArray(t.dependances) && t.dependances.every((d: any) => typeof d === 'string')
        && ['attente', 'en cours', 'bloquee', 'faite', 'erreur', 'arretee'].includes(t.etat)
        && (t.fournisseur === undefined || ['claude', 'codex', 'perplexity'].includes(t.fournisseur));
}
export function decoderEquipes(contenu: string): Equipe[] {
    const valeur = JSON.parse(contenu);
    if (!Array.isArray(valeur) || !valeur.every((e) => objet(e)
        && ['id', 'projet', 'nomProjet', 'objectif'].every((k) => typeof e[k] === 'string')
        && ['planification', 'plan', 'en cours', 'prete', 'integration', 'finie', 'erreur'].includes(e.etat)
        && Number.isFinite(e.creee) && Array.isArray(e.taches) && e.taches.every(tacheValide)
        && new Set(e.taches.map((t: Tache) => t.id)).size === e.taches.length
        && (e.integrateur === undefined || tacheValide(e.integrateur)))
        || new Set(valeur.map((e: Equipe) => e.id)).size !== valeur.length) throw new Error('Structure des équipes invalide');
    return valeur;
}
export function lireStockageEquipes(): Equipe[] {
    try { return decoderEquipes(fs.readFileSync(CHEMINS.equipes, 'utf8')); }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !fs.existsSync(SAUVEGARDE_EQUIPES)) return [];
        throw new Error('Fichier des équipes illisible ou invalide. Données conservées · Équipes → Récupérer les équipes.');
    }
}
// Sous le verrou des équipes : ne jamais remplacer la sauvegarde par un fichier invalide.
export function ecrireStockageEquipes(equipes: Equipe[]): void {
    const precedentes = lireStockageEquipes();
    decoderEquipes(JSON.stringify(equipes));
    ecrireAtomique(SAUVEGARDE_EQUIPES, fs.existsSync(CHEMINS.equipes) ? precedentes : equipes);
    ecrireAtomique(CHEMINS.equipes, equipes);
}
export function sauvegardeEquipes(): { equipes: Equipe[]; date: number; empreinte: string } {
    try {
        const contenu = fs.readFileSync(SAUVEGARDE_EQUIPES, 'utf8');
        return { equipes: decoderEquipes(contenu), date: fs.statSync(SAUVEGARDE_EQUIPES).mtimeMs,
            empreinte: createHash('sha256').update(contenu).digest('hex') };
    } catch { throw new Error('Aucune sauvegarde valide disponible. Le fichier original est conservé. Restaure une copie personnelle, puis choisis Réessayer la lecture.'); }
}
/** Sous le verrou des équipes, après mise en pause du moteur. */
export function restaurerStockageEquipes(attendue: string): string | undefined {
    const sauvegarde = sauvegardeEquipes();
    if (sauvegarde.empreinte !== attendue) throw new Error('La sauvegarde a changé. Consulte-la de nouveau avant de restaurer.');
    let copie: string | undefined;
    try {
        const contenu = fs.readFileSync(CHEMINS.equipes);
        copie = `${CHEMINS.equipes}.recup-${Date.now()}-${randomUUID()}.json`;
        fs.writeFileSync(copie, contenu, { flag: 'wx', mode: 0o600 });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    ecrireAtomique(CHEMINS.equipes, sauvegarde.equipes);
    return copie;
}
