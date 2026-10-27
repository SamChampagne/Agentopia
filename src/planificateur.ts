import * as fs from 'fs';
import * as path from 'path';
import { CHEMINS } from './chemins.js';
import { chargerConfig } from './config.js';
import { lancerArrierePlan } from './agents.js';
import { toast } from './notifications.js';

// Tâches planifiées : chaque jour (ou certains jours) à une heure donnée, une session Claude d'arrière-plan
// démarre sur un projet avec une consigne. Elles tournent pendant que Claudetopia est ouvert ; si l'heure est
// passée pendant qu'il était fermé, la tâche part au lancement suivant, le même jour.

export interface Planification {
    id: string;
    nom: string;
    heure: string;              // « 08:00 »
    jours: number[];            // 0 = dimanche … 6 = samedi ; vide = tous les jours
    projet: string;             // dossier
    consigne: string;
    actif: boolean;
}

const jour = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function derniersLancements(): Record<string, string> {
    try {
        return JSON.parse(fs.readFileSync(CHEMINS.planifications, 'utf-8'));
    } catch {
        return {};
    }
}

function noterLancement(id: string): void {
    const d = derniersLancements();
    d[id] = jour();
    fs.writeFileSync(CHEMINS.planifications, JSON.stringify(d, null, 2), 'utf-8');
}

export const dernierLancement = (id: string): string | undefined => derniersLancements()[id];

export function decrireJours(jours: number[]): string {
    if (!jours.length || jours.length === 7) return 'tous les jours';
    if (jours.join() === '1,2,3,4,5') return 'du lundi au vendredi';
    return jours.map((j) => ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][j]).join(', ');
}

export async function lancerPlanification(p: Planification): Promise<{ ok: boolean; message: string; id?: string }> {
    if (!fs.existsSync(p.projet)) return { ok: false, message: `dossier introuvable : ${p.projet}` };
    const { id, sortie } = await lancerArrierePlan(p.projet, `⏰ ${p.nom}`, p.consigne);
    if (!id) return { ok: false, message: sortie.split('\n').find(Boolean) ?? 'la session n\'a pas démarré' };
    noterLancement(p.id);
    return { ok: true, message: `session ${id} lancée sur ${path.basename(p.projet)}`, id };
}

// Appelé toutes les minutes
let enCours = false;
export async function verifierPlanifications(): Promise<void> {
    if (enCours) return;
    enCours = true;
    try {
        const maintenant = new Date();
        const hhmm = `${String(maintenant.getHours()).padStart(2, '0')}:${String(maintenant.getMinutes()).padStart(2, '0')}`;
        for (const p of chargerConfig().planifications ?? []) {
            if (!p.actif || hhmm < p.heure || dernierLancement(p.id) === jour()) continue;
            if (p.jours.length && !p.jours.includes(maintenant.getDay())) continue;
            const r = await lancerPlanification(p);
            toast(r.ok ? `⏰ ${p.nom} a démarré` : `✕ ${p.nom} n'a pas démarré`, r.message, r.id ? `claudetopia:session/${r.id}` : undefined);
            if (!r.ok) noterLancement(p.id);   // pas de nouvel essai toutes les minutes : demain, ou « lancer maintenant »
        }
    } finally {
        enCours = false;
    }
}
