import { executerFournisseur } from './providers/registre.js';
import * as fs from 'node:fs';
import { CHEMINS, surPath } from './chemins.js';
import { chargerConfig, type Config } from './config.js';
import { disponibilite } from './providers/config.js';
import { FOURNISSEURS, type Fournisseur, type ContexteAgent } from './providers/types.js';
import { validerDependances } from './equipePlan.js';
import { commencerUsage, sauverUsage } from './utilisation.js';
import type { Utilisation } from './providers/types.js';

export type FournisseurMaitre = Fournisseur | 'claude-cli';
export function fournisseurMaitre(config: Config, disponible = (f: FournisseurMaitre) => f === 'claude-cli' ? !!surPath('claude') : disponibilite(f).pret): FournisseurMaitre | undefined {
    const explicite = config.maitre?.fournisseur;
    if (explicite && explicite !== 'auto' && (explicite === 'claude-cli' || Object.hasOwn(FOURNISSEURS, explicite))) return explicite;
    const prefere = config.fournisseurDefaut;
    if (prefere && prefere !== 'choisir' && disponible(prefere)) return prefere;
    return (['codex', 'claude-cli', 'claude', 'perplexity'] as const).find(disponible);
}
export const nomMaitre = (f?: FournisseurMaitre) => f === 'claude-cli' ? 'Claude CLI' : f ? FOURNISSEURS[f].nom : 'à configurer';
let controleur: AbortController | undefined;
export function interrompreConseil() { controleur?.abort(); }
export async function conseiller(f: Fournisseur, prompt: string, executer = executerFournisseur, options: { cwd?: string } = {}): Promise<{ texte?: string; erreur?: string }> {
    fs.mkdirSync(CHEMINS.maitre, { recursive: true });
    controleur = new AbortController();
    const delai = Math.min(120_000, Math.max(1, chargerConfig().limitesAgents?.dureeMinutes || 60) * 60_000);
    const signal = AbortSignal.any([controleur.signal, AbortSignal.timeout(delai)]);
    let recu: string | undefined, usage: Utilisation = {};
    const contexte: ContexteAgent = { session: { id: 'conseil', fournisseur: f, modele: chargerConfig().modelesFournisseurs?.[f], cwd: options.cwd ?? CHEMINS.maitre, titre: 'Conseil', creee: Date.now(), maj: Date.now(), tour: '', etat: 'travaille' },
        utilisation: (u) => { usage = u; if (recu) sauverUsage(recu, usage); },
        prompt, historique: [], signal, conseil: true, evenement: () => {}, thread: () => {}, permission: async () => ({ accepte: false }) };
    try { recu = commencerUsage('conseil', f); const texte = await executer(contexte); sauverUsage(recu, usage, 'success'); return { texte }; }
    catch (e) { try { if (recu) sauverUsage(recu, usage, 'error'); } catch { /* Garder l'erreur initiale ; reçu incomplet visible. */ }
        return { erreur: `${nomMaitre(f)} : ${(e as Error).message.replace(/(?:sk-|pplx-)[\w-]+/g, '[clé masquée]').slice(0, 400)}` }; }
    finally { controleur = undefined; }
}

export interface PlanMaitre { projet: string; objectif: string; taches: { titre: string; fournisseur: Fournisseur; consigne: string; dependances: string[] }[] }
export function validerPlanMaitre(brut: any, projets: string[]): PlanMaitre {
    if (!brut || !projets.includes(brut.projet) || typeof brut.objectif !== 'string' || !brut.objectif.trim() || !Array.isArray(brut.taches)) throw new Error('Le maître a proposé un projet ou un plan invalide. Rien n’a été lancé.');
    for (const t of brut.taches) {
        if (!t || !Object.hasOwn(FOURNISSEURS, t.fournisseur) || typeof t.titre !== 'string' || !t.titre.trim() || typeof t.consigne !== 'string' || !t.consigne.trim()
            || !Array.isArray(t.dependances) || t.dependances.some((d: unknown) => typeof d !== 'string')) throw new Error('Tâche du maître invalide. Rien n’a été lancé.');
    }
    validerDependances(brut.taches.map((t: any, i: number) => ({ id: `t${i + 1}`, dependances: t.dependances })));
    return { projet: brut.projet, objectif: brut.objectif, taches: brut.taches.map((t: any) => ({ titre: t.titre, fournisseur: t.fournisseur, consigne: t.consigne, dependances: t.dependances })) };
}

export async function proposerPlan(plan?: PlanMaitre): Promise<void> {
    if (!plan) return;
    const { choisir, bus } = await import('./ui/bus.js');
    const detail = plan.taches.map((t, i) => `t${i + 1} · ${FOURNISSEURS[t.fournisseur].nom} · ${t.titre}\n${t.consigne}\nAprès : ${t.dependances.join(', ') || 'aucune dépendance'}`).join('\n\n');
    const action = await choisir(`Équipe proposée · ${plan.projet}`, [
        { label: 'Créer et lancer cette équipe', valeur: 'lancer', description: 'Les agents réalisent ce plan dans des branches séparées.' },
        { label: 'Garder le plan sans démarrer', valeur: 'plan' },
        { label: 'Annuler', valeur: 'annuler' },
    ], false, `${plan.objectif}\n\n${detail}`);
    if (action === 'annuler') return;
    const { getProjets } = await import('./commandes.js');
    const candidats = getProjets().filter((p) => p.nom === plan.projet || p.chemin === plan.projet);
    if (candidats.length !== 1) throw new Error('Projet ambigu ou introuvable. Choisis-le dans Projets puis crée une équipe.');
    if (action === 'lancer') {
        const { guiderConnexion } = await import('./providers/assistantConnexion.js');
        for (const f of new Set(plan.taches.map((t) => t.fournisseur))) await guiderConnexion(f, true);
    }
    const { creerEquipeMixte, lancerEquipe } = await import('./equipe.js');
    const equipe = creerEquipeMixte(candidats[0], plan.objectif, plan.taches);
    if (action === 'lancer') { const erreur = await lancerEquipe(equipe.id); if (erreur) throw new Error(erreur); }
    bus.emit('lancer', `/equipe ${equipe.id}`);
}
