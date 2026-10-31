import { chargerConfig } from './config.js';
import { listerIntegrees } from './sessionsIntegrees.js';
import type { Fournisseur } from './providers/types.js';
import type { Equipe, Tache } from './equipe.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CHEMINS } from './chemins.js';
import { sousVerrou, processusVivant, demarragePoste } from './verrou.js';
import { lireFichierBorne, ecrireFichierAtomique, verifierCheminLocal } from './fichiersProteges.js';
import { estFournisseur } from './providers/types.js';
import { lireRecusPlanifications } from './stockagePlanifications.js';

const dossier = path.join(CHEMINS.moteur, 'places-agents'), verrou = `${dossier}.verrou`;
const ecrireAtomique = (fichier: string, contenu: unknown) => ecrireFichierAtomique(fichier, JSON.stringify(contenu));
function verrouCapacite<T>(fn: () => T): T { verifierCheminLocal(verrou); return sousVerrou(verrou, fn); }
interface Reservation { cle: string; token: string; fournisseur: Fournisseur; session?: string; pid: number; demarrage: number }
function reservations(): Reservation[] {
    verifierCheminLocal(dossier);
    try { return fs.readdirSync(dossier).filter((f) => /^[a-f0-9]{64}\.json$/.test(f)).flatMap((f) => {
        try { const fichier = path.join(dossier, f), info = fs.lstatSync(fichier);
            if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > 16_384) throw new Error('Fichier réservation invalide');
            const r = JSON.parse(lireFichierBorne(fichier, 16_384).toString('utf8')) as Reservation;
            if (!r || typeof r.cle !== 'string' || r.cle.length > 512 || typeof r.token !== 'string' || !estFournisseur(r.fournisseur)
                || !Number.isInteger(r.pid) || r.pid <= 0 || !Number.isFinite(r.demarrage)
                || r.session !== undefined && (typeof r.session !== 'string' || !/^ct-[a-f0-9-]{36}$/.test(r.session))
                || `${createHash('sha256').update(r.cle).digest('hex')}.json` !== f) throw new Error('Structure réservation invalide');
            if (!processusVivant(r.pid, r.demarrage)) { fs.rmSync(fichier, { force: true }); return []; }
            return [r];
        } catch { throw new Error('Réservation d’agent illisible ; consulte le moteur avant de reprendre.'); }
    }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}
const rotation = path.join(CHEMINS.moteur, 'rotation-file.json');
export function ordreFile(equipes: Equipe[]): Equipe[] {
    const triees = [...equipes].sort((a, b) => a.creee - b.creee || a.id.localeCompare(b.id));
    let derniere: unknown; try { derniere = JSON.parse(fs.readFileSync(rotation, 'utf8')).equipe; } catch { /* Première rotation. */ }
    const index = triees.findIndex((e) => e.id === derniere);
    return index < 0 ? triees : [...triees.slice(index + 1), ...triees.slice(0, index + 1)];
}
export function equipeServie(id: string): void { ecrireAtomique(rotation, { equipe: id }); }

export interface CapaciteAgents { total: number; limite: number; fournisseurs: Partial<Record<Fournisseur, number>>; limitesFournisseurs: Partial<Record<Fournisseur, number>> }
export function capaciteAgents(equipes: Equipe[] = [], ignorerSession?: string): CapaciteAgents {
    const config = chargerConfig().equipe;
    const sessions = listerIntegrees(true).filter((s) => s.id !== ignorerSession && ['travaille', 'bloquee'].includes(s.etat));
    const connus = new Set(sessions.map((s) => s.id));
    const fournisseurs: Partial<Record<Fournisseur, number>> = {};
    for (const s of sessions) fournisseurs[s.fournisseur] = (fournisseurs[s.fournisseur] || 0) + 1;
    let total = sessions.length;
    const reservees = reservations();
    for (const r of reservees) {
        if (r.session && (r.session === ignorerSession || connus.has(r.session))) continue;
        total++; fournisseurs[r.fournisseur] = (fournisseurs[r.fournisseur] || 0) + 1;
    }
    for (const e of equipes) for (const t of [...e.taches, ...(e.integrateur ? [e.integrateur] : [])]) {
        if (!['en cours', 'bloquee'].includes(t.etat) || t.agentId && connus.has(t.agentId) || reservees.some((r) => r.cle === `${e.id}/${t.id}/${t.tentative}`)) continue;
        total++; if (t.fournisseur) fournisseurs[t.fournisseur] = (fournisseurs[t.fournisseur] || 0) + 1;
    }
    return { total, fournisseurs, limite: config.paralleleGlobal ?? 0, limitesFournisseurs: config.parFournisseur || {} };
}
/** La transition vers travaille doit être sauvée dans fn avant de libérer le verrou. */
export function sousCapaciteAgent<T>(id: string, fournisseur: Fournisseur, fn: () => T): T {
    return verrouCapacite(() => { const raison = raisonCapacite(capaciteAgents([], id), fournisseur); if (raison) throw new Error(`${raison} · /file-agents pour voir les attentes`); return fn(); });
}
export function reserverPreparationAgent(cle: string, fournisseur: Fournisseur): { lierSession(id: string): void; liberer(): void } {
    const fichier = path.join(dossier, `${createHash('sha256').update(cle).digest('hex')}.json`);
    const r: Reservation = { cle, fournisseur, token: randomUUID(), pid: process.pid, demarrage: demarragePoste() };
    verrouCapacite(() => {
        const raison = raisonCapacite(capaciteAgents(), fournisseur); if (raison) throw new Error(raison);
        fs.mkdirSync(dossier, { recursive: true }); ecrireAtomique(fichier, r);
    });
    return {
        lierSession(id) { verrouCapacite(() => { if (JSON.parse(lireFichierBorne(fichier, 16_384).toString('utf8')).token !== r.token) throw new Error('Réservation remplacée'); r.session = id; ecrireAtomique(fichier, r); }); },
        liberer() { verrouCapacite(() => { try { if (JSON.parse(lireFichierBorne(fichier, 16_384).toString('utf8')).token === r.token) fs.rmSync(fichier, { force: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }); },
    };
}
export function raisonCapacite(c: CapaciteAgents, fournisseur?: Fournisseur): string | undefined {
    if (c.limite > 0 && c.total >= c.limite) return `Plafond global atteint (${c.total}/${c.limite})`;
    const limite = fournisseur && c.limitesFournisseurs[fournisseur];
    if (limite && (c.fournisseurs[fournisseur!] || 0) >= limite) return `Plafond ${fournisseur} atteint (${c.fournisseurs[fournisseur!]}/${limite})`;
    return undefined;
}
export function reserverCapacite(c: CapaciteAgents, fournisseur?: Fournisseur): void {
    c.total++; if (fournisseur) c.fournisseurs[fournisseur] = (c.fournisseurs[fournisseur] || 0) + 1;
}
export function decrireFile(equipes: Equipe[]): string {
    const c = capaciteAgents(equipes), lignes = [`${c.total} agent(s) actif(s) · plafond global ${c.limite || 'illimité'} · plafond par équipe ${chargerConfig().equipe.parallele}`];
    for (const e of equipes) for (const t of e.taches) if (t.etat === 'attente') lignes.push(`${e.nomProjet} · ${t.titre} · ${t.attenteFile || (t.dependances.length ? 'Attend les dépendances' : 'Attend le lancement de l’équipe')}`);
    try { const recus = lireRecusPlanifications(); for (const p of chargerConfig().planifications || []) if (p.actif && recus[p.id]?.etat === 'attente') lignes.push(`Planification · ${p.nom} · ${recus[p.id].message} · /planifications pour désactiver cette attente`); }
    catch { lignes.push('Historique des planifications illisible · /planifications-recuperer'); }
    return lignes.join('\n');
}
