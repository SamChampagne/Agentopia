import * as fs from 'node:fs';
import * as path from 'node:path';
import { CHEMINS } from './chemins.js';
import { chargerConfig } from './config.js';
import { lancerArrierePlan } from './agents.js';
import { creerIntegree, envoyerIntegree, ecrireAtomique } from './sessionsIntegrees.js';
import { disponibilite } from './providers/config.js';
import type { Fournisseur } from './providers/types.js';
import { sousVerrou } from './verrou.js';
import { commanderMoteur, localAuMoteur, moteurEnPause } from './moteurClient.js';
import { toast } from './notifications.js';
import { lireRecusPlanifications, ecrireRecusPlanifications, jourPlanification as jour, type RecuPlanification as Recu } from './stockagePlanifications.js';
import { capaciteAgents, raisonCapacite } from './fileAgents.js';
import { verifierCheminLocal } from './fichiersProteges.js';

export interface Planification {
    id: string; nom: string; heure: string; jours: number[]; projet: string; consigne: string; actif: boolean;
    fournisseur?: Fournisseur; // absent = ancienne tâche Claude CLI, conservée sans migration payante implicite
}
type Resultat = { ok: boolean; message: string; id?: string };
const recus = lireRecusPlanifications;
export function recuPlanification(id: string): Recu | undefined {
    return recus()[id];
}
export const dernierLancement = (id: string): string | undefined => {
    const r = recuPlanification(id); return r ? `${r.jour} · ${r.etat === 'reserve' ? 'lancement à vérifier' : r.etat}${r.message ? ` · ${r.message}` : ''}` : undefined;
};
export const heureValide = (h: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(h);
export function decrireJours(jours: number[]): string {
    if (!jours.length || jours.length === 7) return 'tous les jours';
    if (jours.join() === '1,2,3,4,5') return 'du lundi au vendredi';
    return jours.map((j) => ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][j]).join(', ');
}
async function demarrer(p: Planification): Promise<Resultat> {
    if (!fs.existsSync(p.projet)) throw new Error(`Dossier introuvable : ${p.projet}`);
    if (p.fournisseur) {
        const d = disponibilite(p.fournisseur); if (!d.pret) throw new Error(d.texte);
        const s = creerIntegree(p.fournisseur, p.projet, `◴ ${p.nom}`);
        await envoyerIntegree(s.id, p.consigne);
        return { ok: true, message: `Session ${s.id} lancée sur ${path.basename(p.projet)}`, id: s.id };
    }
    const { id, sortie } = await lancerArrierePlan(p.projet, `◴ ${p.nom}`, p.consigne);
    return id ? { ok: true, message: `Session Claude CLI ${id} lancée`, id } : { ok: false, message: sortie.split('\n').find(Boolean) ?? 'La session n’a pas démarré' };
}
export async function lancerPlanification(p: Planification, automatique = false, lancer = demarrer): Promise<Resultat> {
    if (!localAuMoteur()) return commanderMoteur('planification', p.id);
    if (moteurEnPause()) return { ok: false, message: 'Moteur en pause · Config → Moteur des équipes' };
    verifierCheminLocal(`${CHEMINS.planifications}.verrou`);
    let capacite: string | undefined;
    // Réserver AVANT le lancement : un crash ne doit pas rejouer une demande facturable.
    const reserve = sousVerrou(`${CHEMINS.planifications}.verrou`, () => {
        const d = recus(), precedent = recuPlanification(p.id);
        if (automatique && precedent?.jour === jour() && precedent.etat !== 'attente') return false;
        capacite = raisonCapacite(capaciteAgents(), p.fournisseur);
        if (capacite) { if (automatique) { d[p.id] = { jour: jour(), etat: 'attente', message: capacite }; ecrireRecusPlanifications(d); } return false; }
        d[p.id] = { jour: jour(), etat: 'reserve' }; ecrireRecusPlanifications(d); return true;
    });
    if (!reserve) return { ok: false, message: capacite ? `${capacite}. ${automatique ? 'La planification attend une place ; aucun tour réservé.' : 'Réessaie quand une place se libère ; aucun tour réservé.'}` : 'Cette tâche a déjà été tentée aujourd’hui' };
    let r: Resultat;
    try { r = await lancer(p); } catch (e) { r = { ok: false, message: (e as Error).message.replace(/(?:sk-|pplx-)[\w-]+/g, '[clé masquée]').slice(0, 400) }; }
    sousVerrou(`${CHEMINS.planifications}.verrou`, () => {
        const d = recus(); d[p.id] = { jour: jour(), etat: r.ok ? 'lance' : 'erreur', message: r.message, session: r.id };
        ecrireRecusPlanifications(d);
    });
    return r;
}
let enCours = false;
export async function verifierPlanifications(): Promise<void> {
    if (enCours || moteurEnPause()) return;
    enCours = true;
    try {
        const maintenant = new Date(), hhmm = `${String(maintenant.getHours()).padStart(2, '0')}:${String(maintenant.getMinutes()).padStart(2, '0')}`;
        for (const p of chargerConfig().planifications ?? []) {
            const recu = recuPlanification(p.id);
            if (!p.actif || !heureValide(p.heure) || hhmm < p.heure || recu?.jour === jour() && recu.etat !== 'attente') continue;
            if (p.jours.length && !p.jours.includes(maintenant.getDay())) continue;
            const r = await lancerPlanification(p, true);
            toast(r.ok ? `◴ ${p.nom} a démarré` : `✕ ${p.nom} n’a pas démarré`, r.message);
        }
    } finally { enCours = false; }
}
