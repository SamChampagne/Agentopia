import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { chargerConfig } from './config.js';
import { sousVerrou } from './verrou.js';
import { ecrireAtomique } from './sessionsIntegrees.js';
import type { Fournisseur, Utilisation } from './providers/types.js';

export interface RecuUsage extends Utilisation { id: string; session: string; fournisseur: Fournisseur; date: number; etat: 'en cours' | 'success' | 'error' | 'cancelled' }
const jour = (date: number) => new Date(date).toLocaleDateString('en-CA');
export function lireUsage(date: number | null = Date.now()): RecuUsage[] {
    try { return fs.readdirSync(CHEMINS.utilisation).filter((f) => f.endsWith('.json')).flatMap((f) => {
        try { const r = JSON.parse(fs.readFileSync(path.join(CHEMINS.utilisation, f), 'utf8')); return date === null || jour(r.date) === jour(date) ? [r] : []; } catch { return []; }
    }); } catch { return []; }
}
export function commencerUsage(session: string, fournisseur: Fournisseur): string {
    return sousVerrou(`${CHEMINS.utilisation}.verrou`, () => {
        if (fs.existsSync(path.join(CHEMINS.moteur, 'pause.json'))) throw new Error('Tout est en pause · Config → Moteur des équipes → Reprendre');
        const max = chargerConfig().limitesAgents?.toursJour ?? 0;
        if (max > 0 && lireUsage().length >= max) throw new Error(`Limite de ${max} tours par jour atteinte · Config → Limites des agents`);
        fs.mkdirSync(CHEMINS.utilisation, { recursive: true });
        const id = randomUUID();
        ecrireAtomique(path.join(CHEMINS.utilisation, `${id}.json`), { id, session, fournisseur, date: Date.now(), etat: 'en cours' });
        return id;
    });
}
export function normaliserUsage(v: Utilisation): Utilisation {
    const r: Utilisation = {};
    for (const cle of ['entree', 'sortie', 'cache', 'coutUSD'] as const) if (typeof v[cle] === 'number' && Number.isFinite(v[cle]) && v[cle]! >= 0) r[cle] = v[cle];
    return r;
}
export function sauverUsage(id: string, usage: Utilisation, etat?: RecuUsage['etat']): void {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Reçu d’utilisation invalide');
    const f = path.join(CHEMINS.utilisation, `${id}.json`);
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    ecrireAtomique(f, { ...r, ...normaliserUsage(usage), ...(etat ? { etat } : {}) });
}
export function bilanUsage(recus = lireUsage()): string {
    const couts = recus.filter((r) => r.coutUSD !== undefined), jetons = recus.filter((r) => r.entree !== undefined && r.sortie !== undefined);
    return `${recus.length} tour(s) démarré(s) · ${jetons.length ? jetons.reduce((n, r) => n + r.entree! + r.sortie!, 0).toLocaleString('fr-CA') + ' jetons renseignés' : 'jetons indisponibles'}\n`
        + (couts.length ? `${couts.reduce((n, r) => n + r.coutUSD!, 0).toFixed(4)} $ US rapportés` : 'Coût indisponible')
        + (couts.length < recus.length ? ` · coût non fourni pour ${recus.length - couts.length} tour(s), total incomplet` : '')
        + (jetons.length < recus.length ? ` · jetons non fournis pour ${recus.length - jetons.length} tour(s)` : '');
}
