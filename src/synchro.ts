import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Projet, listerProjets } from './projets.js';
import { Depot, DepotDistant, lireDepot, ajouterPRs, fetchTout, depotsDistants, cleDepot, trouverDepot, etatPR } from './git.js';
import { chargerConfig } from './config.js';
import { prechargerJetons } from './jetons.js';

// État git de tous les projets, gardé en mémoire et mis à jour en direct :
//  - Windows prévient quand un fichier change dans un dépôt (fs.watch récursif) → on relit ce dépôt seulement
//  - un nouveau dossier dans une racine (git clone…) → il apparaît tout seul
//  - en fond : fetch régulier, pull requests, liste des dépôts sur GitHub / Azure DevOps / GitLab
// Les vues lisent cette mémoire : elles s'ouvrent instantanément.

const RELIRE_TOUT = 2 * 60_000;      // filet de sécurité
const FETCH_AUTO = 5 * 60_000;
const PR = 2 * 60_000;
const DISTANTS = 5 * 60_000;

export const synchro = new EventEmitter();
synchro.setMaxListeners(50);

const depots = new Map<string, Depot>();               // par chemin de projet
const surveillants = new Map<string, fs.FSWatcher[]>();
const minuteries = new Map<string, NodeJS.Timeout>();
let distants: DepotDistant[] = [];
let projetsSuivis: Projet[] = [];
let pret = false;
let dernierFetch: Date | undefined;
let activite = '';                                     // "fetch…", "lecture des dépôts…"
let demarre = false;
let generationComptes = 0;

// Regroupe les mises à jour : au plus une notification aux vues toutes les 250 ms
let publication: NodeJS.Timeout | undefined;
const publier = () => {
    if (!publication) publication = setTimeout(() => { publication = undefined; synchro.emit('maj'); }, 250);
};

// Empreinte de ce que les vues affichent : on ne publie que si quelque chose a changé
const empreinte = (d?: Depot) => d ? JSON.stringify([d.branche, d.amont, d.avance, d.retard, d.modifs, d.dernierCommit, d.remote, d.dernierFetch?.getTime()]) : '';

export interface EtatSynchro {
    depots: Depot[];
    nonClones: DepotDistant[];       // sur GitHub / Azure / GitLab mais pas sur ce poste
    pret: boolean;
    dernierFetch?: Date;
    activite: string;
}

export function lireSynchro(): EtatSynchro {
    const locaux = new Set([...depots.values()].map((d) => d.remote && cleDepot(d.remote)).filter(Boolean));
    return {
        depots: [...depots.values()],
        nonClones: distants.filter((d) => !locaux.has(cleDepot(d.url))),
        pret,
        dernierFetch,
        activite,
    };
}

export function depotDe(chemin: string): Depot | undefined {
    return depots.get(chemin);
}

// ─── Relecture ───────────────────────────────────────────────────────────────

async function relire(p: Projet): Promise<void> {
    const avant = depots.get(p.chemin);
    const d = await lireDepot(p);
    if (!d) {
        if (!avant) return;
        depots.delete(p.chemin);
    } else {
        d.prs = avant?.prs;   // garde les PR déjà connues
        depots.set(p.chemin, d);
        if (empreinte(avant) === empreinte(d)) return;
    }
    publier();
}

// Plusieurs événements rapprochés (une sauvegarde, un commit) → une seule relecture
function planifier(p: Projet, delai = 700): void {
    clearTimeout(minuteries.get(p.chemin));
    minuteries.set(p.chemin, setTimeout(() => relire(p), delai));
}

export function relireProjet(chemin: string): Promise<void> {
    const p = projetsSuivis.find((x) => x.chemin === chemin);
    return p ? relire(p) : Promise.resolve();
}

async function relireTout(): Promise<void> {
    for (let i = 0; i < projetsSuivis.length; i += 6) await Promise.all(projetsSuivis.slice(i, i + 6).map((p) => relire(p)));
}

// ─── Surveillance des fichiers ───────────────────────────────────────────────

// Dossiers qui changent sans arrêt sans changer l'état git (dépendances, compilation, verrous)
const IGNORES = /(^|[\\/])(node_modules|\.next|\.nuxt|\.turbo|\.cache|\.vs|\.idea|dist|build|bin|obj|out|coverage|__pycache__|\.venv)([\\/]|$)|\.git[\\/](objects|logs|lfs)[\\/]|\.lock$/;

function surveiller(p: Projet): void {
    if (surveillants.has(p.chemin) || !trouverDepot(p.chemin)) return;
    try {
        const w = fs.watch(p.chemin, { recursive: true }, (_, fichier) => {
            const f = String(fichier ?? '');
            if (IGNORES.test(f)) return;
            planifier(p);
            // Un changement dans le .git d'un dépôt principal concerne aussi ses worktrees
            if (/(^|[\\/])\.git([\\/]|$)/.test(f)) {
                for (const autre of projetsSuivis) {
                    if (autre !== p && depots.get(autre.chemin)?.worktree && depots.get(autre.chemin)?.remote === depots.get(p.chemin)?.remote) planifier(autre, 1200);
                }
            }
        });
        w.on('error', () => undefined);
        surveillants.set(p.chemin, [w]);
    } catch {
        // dossier inaccessible : le filet de sécurité (relecture périodique) s'en occupe
    }
}

function arreterSurveillance(chemin: string): void {
    surveillants.get(chemin)?.forEach((w) => w.close());
    surveillants.delete(chemin);
    depots.delete(chemin);
}

// Ajoute / retire des projets (appelé après un /scan, un ajout de racine, ou quand une racine change)
export function ajusterProjets(liste: Projet[]): void {
    const avant = new Set(projetsSuivis.map((p) => p.chemin));
    const apres = new Set(liste.map((p) => p.chemin));
    projetsSuivis = liste;
    // Le watcher des racines et les scans manuels publient le même catalogue.
    // Les vues déjà ouvertes ne doivent pas garder une copie devenue obsolète.
    synchro.emit('projets', liste);
    if (!demarre) return;
    for (const chemin of avant) if (!apres.has(chemin)) arreterSurveillance(chemin);
    const nouveaux = liste.filter((p) => !avant.has(p.chemin));
    nouveaux.forEach((p) => {
        surveiller(p);
        relire(p);
    });
    if (nouveaux.length || avant.size !== apres.size) publier();
}

const surveillantsRacines: fs.FSWatcher[] = [];
function surveillerRacines(): void {
    surveillantsRacines.forEach((w) => w.close());
    surveillantsRacines.length = 0;
    let minuterie: NodeJS.Timeout | undefined;
    for (const racine of chargerConfig().racines) {
        try {
            const w = fs.watch(racine, () => {
                clearTimeout(minuterie);
                minuterie = setTimeout(() => ajusterProjets(listerProjets(chargerConfig())), 1500);
            });
            w.on('error', () => undefined);
            surveillantsRacines.push(w);
        } catch {
            // racine absente
        }
    }
}

// ─── En fond : fetch, PR, dépôts distants ────────────────────────────────────

let fetchEnCours = false;
export async function fetchMaintenant(surProgres?: (n: number) => void): Promise<string[]> {
    if (fetchEnCours) return [];
    fetchEnCours = true;
    activite = 'fetch des dépôts…';
    publier();
    try {
        const erreurs = await fetchTout([...depots.values()], surProgres);
        dernierFetch = new Date();
        await relireTout();
        return erreurs;
    } finally {
        fetchEnCours = false;
        activite = '';
        publier();
    }
}

async function rafraichirPRs(): Promise<void> {
    const generation = generationComptes, compte = chargerConfig().compteGitHub;
    const copies = [...depots.values()].map(d => ({ ...d }));
    await ajouterPRs(copies);
    if (generation !== generationComptes || compte !== chargerConfig().compteGitHub) return;
    for (const d of copies) { const courant = depots.get(d.projet.chemin); if (courant && courant.remote === d.remote) courant.prs = d.prs; }
    publier();
}

export async function rafraichirDistants(): Promise<void> {
    const generation = generationComptes, compte = chargerConfig().compteGitHub;
    const nouveaux = await depotsDistants([...depots.values()]);
    if (generation !== generationComptes || compte !== chargerConfig().compteGitHub) return;
    distants = nouveaux;
    publier();
}

export async function actualiserCompteGitHub(): Promise<void> {
    generationComptes++;
    delete etatPR.GitHub;
    for (const d of depots.values()) if (d.hebergeur === 'GitHub') d.prs = undefined;
    distants = distants.filter(d => d.hebergeur !== 'GitHub');
    publier();
    await Promise.all([rafraichirPRs(), rafraichirDistants()]);
}

function toutesLes(delai: number, fn: () => Promise<unknown>): void {
    setInterval(() => fn().catch(() => undefined), delai).unref();
}

export function demarrerSynchro(projets: Projet[]): void {
    if (demarre) return;
    demarre = true;
    projetsSuivis = projets;
    activite = 'lecture des dépôts…';
    (async () => {
        projetsSuivis.forEach(surveiller);
        surveillerRacines();
        await relireTout();
        pret = true;
        activite = '';
        publier();
        await prechargerJetons();
        await rafraichirPRs();
        await rafraichirDistants();
    })().catch(() => undefined);
    toutesLes(RELIRE_TOUT, relireTout);
    toutesLes(PR, rafraichirPRs);
    toutesLes(DISTANTS, rafraichirDistants);
    toutesLes(FETCH_AUTO, () => (chargerConfig().fetchAuto ? fetchMaintenant() : Promise.resolve([])));
}
