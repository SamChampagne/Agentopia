import * as fs from 'fs';
import * as path from 'path';
import { CHEMINS } from '../chemins.js';
const DOSSIER_MAITRE = path.resolve(CHEMINS.maitre).toLowerCase();
import { EventEmitter } from 'events';
import { useEffect, useState } from 'react';
import { SessionActive, sessionsActives } from '../systeme.js';
import { SessionVue, Activite, listerAgents, lireTranscript, activite, contexteSession, limiteContexte, horairesSession, DOSSIERS_AGENTS } from '../agents.js';
import { Hote, listerConteneurs } from '../docker.js';
import { chargerConfig } from '../config.js';
import { toast, jouerSon } from '../notifications.js';
import { bus } from './bus.js';
import { mettreAJourCout, dollars } from '../cout.js';
import { fichiersChauds } from '../modifications.js';
import { assurerMoteur, moteurEnPause } from '../moteurClient.js';
import { Equipe, equipes, lireEquipes, agentsDesEquipes, suivreFichierEquipes, erreurStockageEquipes } from '../equipe.js';
import {
    Serveur, UsageProjet, ConnexionActive, Acces, inventaire, usageParServeur, joignable, connexionsActives, lireAcces,
} from '../ssh.js';

// Données "live" partagées par le panneau d'accueil, la barre de statut et /ssh.
// Chaque source a son propre rythme : les sessions sont des fichiers (rapide),
// les connexions TCP passent par PowerShell (plus lent).

export interface Donnees {
    sessions: SessionActive[];
    serveurs: Serveur[];
    usage: Map<Serveur, UsageProjet[]>;
    joignables: Map<Serveur, boolean>;
    connexions: ConnexionActive[];
    acces: Record<string, Acces>;
    agents: SessionVue[];                   // toutes les sessions Claude (onglets + arrière-plan)
    activites: Map<string, Activite>;       // ce qui se passe dans chacune (fin du transcript)
    docker: Hote[];                         // local d'abord, puis les serveurs surveillés
    equipes: Equipe[];                      // équipes d'agents (une carte chacune)
    erreurEquipes?: string;
    cout: { total: number; jetons: number; parSession: Record<string, number> };   // équivalent API du jour ($)
}

const donnees: Donnees = {
    cout: { total: 0, jetons: 0, parSession: {} },
    equipes: lireEquipes(),
    erreurEquipes: erreurStockageEquipes(),
    agents: [],
    activites: new Map(),
    docker: [],
    sessions: [],
    serveurs: [],
    usage: new Map(),
    joignables: new Map(),
    connexions: [],
    acces: {},
};
const emetteur = new EventEmitter();
// On ne redessine l'écran que si les données ont réellement changé (et au plus toutes les 150 ms)
let derniere = '';
let publication: NodeJS.Timeout | undefined;
const instantane = () => JSON.stringify(donnees, (_, v) => (v instanceof Map ? [...v] : v));
const publier = (forcer = false) => {
    if (publication) return;
    publication = setTimeout(() => {
        publication = undefined;
        const maintenant = instantane();
        if (!forcer && maintenant === derniere) return;
        derniere = maintenant;
        emetteur.emit('maj');
    }, 150);
};

let demarre = false;

function boucle(fn: () => Promise<void> | void, intervalle: number): void {
    const tour = async () => {
        try {
            await fn();
        } catch {
            // une source en erreur ne bloque pas les autres
        }
        publier();
        setTimeout(tour, intervalle).unref();
    };
    tour();
}

// Activité d'une session : on ne relit le transcript que s'il a changé depuis la dernière fois
const activitesConnues = new Map<string, { cle: string; valeur: ReturnType<typeof activite> }>();
function activiteDe(fichier: string): ReturnType<typeof activite> {
    let cle = '';
    try {
        const st = fs.statSync(fichier);
        cle = `${st.mtimeMs}:${st.size}`;
    } catch {
        // transcript pas encore créé
    }
    const connu = activitesConnues.get(fichier);
    if (connu && connu.cle === cle) return connu.valeur;
    // Les horaires viennent d'un lecteur à part, qui couvre la dernière heure (le pouls de la vue Live)
    const valeur = { ...activite(lireTranscript(fichier, 600_000)), contexte: contexteSession(fichier), horaires: horairesSession(fichier) };
    activitesConnues.set(fichier, { cle, valeur });
    return valeur;
}

// Notifications basées sur les cartes (onglets ET arrière-plan) : une session qui travaillait
// et qui s'arrête t'attend ; une session qui passe en "bloquée" attend une permission
const debutTravail = new Map<string, number>();
// Sessions déjà prévenues que leur contexte est presque plein (on reprévient après un /compact)
const contextePlein = new Set<string>();
let contexteVu = false;
function signalerContexte(): void {
    // Premier passage : les sessions déjà pleines au lancement sont notées sans alerte (seul le passage du seuil prévient)
    const silencieux = !contexteVu;
    contexteVu = true;
    for (const a of donnees.agents) {
        const jetons = donnees.activites.get(a.sessionId)?.contexte;
        if (!jetons || a.statut === 'terminee') continue;
        const part = jetons / limiteContexte(jetons);
        if (part < 0.5) contextePlein.delete(a.sessionId);
        if (part < 0.8 || contextePlein.has(a.sessionId)) continue;
        contextePlein.add(a.sessionId);
        if (silencieux) continue;
        const message = `${Math.round(part * 100)} % du contexte utilisé · ouvre-la et tape /compact, ou termine la tâche et repars d'une session neuve`;
        bus.emit('notice', `◔ ${a.nom} : ${message}`);
        if (chargerConfig().notifications) toast(`◔ ${a.nom} : contexte presque plein`, message, `claudetopia:session/${a.id ?? a.sessionId}`, 'alerte');
    }
}

function signalerChangements(avant: Map<string, string>): void {
    signalerContexte();
    const notifier = chargerConfig().notifications;
    const membres = agentsDesEquipes();
    for (const a of donnees.agents) {
        const precedent = avant.get(a.sessionId);
        if (a.statut === 'travaille') {
            if (!debutTravail.has(a.sessionId)) debutTravail.set(a.sessionId, Date.now());
            continue;
        }
        const duree = Date.now() - (debutTravail.get(a.sessionId) ?? Date.now());
        debutTravail.delete(a.sessionId);
        if (precedent !== 'travaille') continue;
        if (a.statut === 'bloquee') {
            if (notifier) toast(`⚠ ${a.nom} attend ${a.question ? 'ta réponse' : 'ta permission'}`, a.question || a.titre || 'Clique pour ouvrir la session', `claudetopia:session/${a.id ?? a.sessionId}`, 'alerte');
            else jouerSon('alerte');
            bus.emit('notice', `! ${a.nom} attend ta permission · clique sa carte`);
        } else if (a.integree && a.issue && a.issue !== 'success') {
            if (notifier) toast(`! ${a.nom} : tour interrompu`, a.erreur || 'Ouvre la conversation pour voir le détail', `claudetopia:session/${a.id}`, 'alerte');
        } else if (duree >= 15_000 && !membres.has(a.id ?? '')) {
            const minutes = Math.round(duree / 60_000);
            if (notifier) toast(`✓ ${a.nom} a fini`, `${a.titre || 'Claude t\'attend'}${minutes ? ` · ${minutes} min de travail` : ''} · clic pour ouvrir`, `claudetopia:session/${a.id ?? a.sessionId}`);
            else jouerSon('fini');
            bus.emit('notice', `✓ ${a.nom} a fini${minutes ? ` (${minutes} min)` : ''} · clique sa carte pour voir`);
        }
    }
}

let derniereErreurMoteur: string | undefined;
async function lireAgents(): Promise<void> {
    const avant = new Map(donnees.agents.map((a) => [a.sessionId, a.statut]));
    // Le maître est un Claude comme les autres : il n'a pas de carte
    donnees.agents = (await listerAgents()).filter((a) => path.resolve(a.cwd).toLowerCase() !== DOSSIER_MAITRE && !estFermee(a.cle));
    donnees.activites = new Map(donnees.agents.map((a) => [a.sessionId, activiteDe(a.fichier)]));
    if (!moteurEnPause() && process.env.CLAUDETOPIA_TEST_UI !== '1') void assurerMoteur()
        .then(() => { derniereErreurMoteur = undefined; })
        .catch((e) => { const message = (e as Error).message; if (message !== derniereErreurMoteur) bus.emit('notice', message); derniereErreurMoteur = message; });
    donnees.equipes = lireEquipes();
    signalerChangements(avant);
    signalerConflits();
}

// Deux sessions actives qui modifient le même fichier dans les 10 dernières minutes : on prévient une fois par fichier
const conflitsVus = new Set<string>();
function signalerConflits(): void {
    for (const f of fichiersChauds(donnees.agents, 10 * 60_000).filter((x) => x.conflit)) {
        const cle = `${f.chemin.toLowerCase()}|${f.sessions.map((s) => s.sessionId).sort().join(',')}`;
        if (conflitsVus.has(cle)) continue;
        conflitsVus.add(cle);
        const qui = f.sessions.map((s) => s.titre || s.nom).join(' et ');
        bus.emit('notice', `⚠ Conflit possible : ${path.basename(f.chemin)} modifié par ${qui} · Alt+H pour voir les fichiers chauds`);
        if (chargerConfig().notifications) toast(`⚠ Conflit possible sur ${path.basename(f.chemin)}`, `${qui} modifient le même fichier`, undefined, 'alerte');
    }
}

// Relecture immédiate (après une fermeture, un lancement…) : les cartes suivent sans attendre le prochain tour
let relecture: NodeJS.Timeout | undefined;
export function rafraichirAgents(delai = 80): void {
    clearTimeout(relecture);
    relecture = setTimeout(() => void lireAgents().then(() => publier()).catch(() => undefined), delai);
}

// Claude Code écrit l'état des sessions dans des fichiers : on les surveille (une carte change dès que Claude écrit)
function surveillerAgents(): void {
    for (const dossier of DOSSIERS_AGENTS) {
        try {
            fs.watch(dossier, { recursive: true }, () => rafraichirAgents(150)).on('error', () => undefined);
        } catch {
            // dossier absent : la relecture toutes les 2,5 s suffit
        }
    }
}

export function demarrerCollecte(): void {
    if (demarre) return;
    demarre = true;
    // Laisse l'interface s'afficher avant de lancer les 26 lectures git
    setTimeout(async () => (await import('../synchro.js')).demarrerSynchro((await import('../commandes.js')).getProjets()), 800);
    boucle(() => { donnees.sessions = sessionsActives().filter((s) => path.resolve(s.cwd).toLowerCase() !== DOSSIER_MAITRE); }, 2000);
    boucle(lireAgents, 2500);
    surveillerAgents();
    boucle(async () => {
        donnees.serveurs = await inventaire();
        donnees.usage = await usageParServeur(donnees.serveurs);
        donnees.acces = lireAcces();
    }, 5 * 60_000);
    boucle(async () => {
        if (!donnees.serveurs.length) return;
        const etats = await Promise.all(donnees.serveurs.map((s) => joignable(s)));
        donnees.joignables = new Map(donnees.serveurs.map((s, i) => [s, etats[i]]));
    }, 60_000);
    boucle(async () => { donnees.connexions = await connexionsActives(); }, 15_000);
    // Coût du jour (équivalent API) et alerte de budget, une fois par jour
    let alerteBudget = '';
    setTimeout(() => boucle(async () => {
        const c = await mettreAJourCout();
        donnees.cout = { total: c.total, jetons: c.jetons, parSession: Object.fromEntries([...c.parSession].map(([k, v]) => [k, v.cout])) };
        const budget = chargerConfig().budgetJour ?? 0;
        if (budget > 0 && c.total >= budget && alerteBudget !== c.jour) {
            alerteBudget = c.jour;
            toast(`! Budget du jour dépassé : ${dollars(c.total)}`, `Ton budget est de ${dollars(budget)} (équivalent API) · /budget pour le changer`);
            bus.emit('notice', `! Budget du jour dépassé : ${dollars(c.total)} sur ${dollars(budget)} (équivalent API)`);
        }
    }, 30_000), 5000);
    boucle(() => rafraichirDocker(false), 15_000);
    // Thème automatique (/theme-auto) : la palette suit l'heure ou le mode de Windows
    boucle(async () => (await import('../themeAuto.js')).appliquerThemeAuto(), 60_000);
    suivreFichierEquipes();
    equipes.on('maj', () => {
        donnees.equipes = lireEquipes();
        donnees.erreurEquipes = erreurStockageEquipes();
        publier();
    });
    // Les « il y a 3 min » avancent même quand rien d'autre ne bouge
    setInterval(() => publier(true), 30_000).unref();
}

// Docker local + serveurs listés dans la config (dockerDistant), en parallèle
// Toutes les 15 s : la liste ; docker stats (CPU, mémoire) une fois sur trois, les dernières valeurs restent affichées ;
// les serveurs distants (ssh) une fois sur deux. complet = tout, tout de suite (vue Docker, réglage changé)
let tourDocker = 0;
export async function rafraichirDocker(complet = true): Promise<void> {
    const tour = complet ? 0 : ++tourDocker;
    const avecStats = tour % 3 === 0;
    const distants = chargerConfig().dockerDistant
        .map((nom) => donnees.serveurs.find((s) => s.nom === nom))
        .filter((s): s is NonNullable<typeof s> => !!s);
    const avant = new Map(donnees.docker.map((h) => [h.nom, h]));
    const hotes = await Promise.all([
        listerConteneurs(undefined, avecStats),
        ...distants.map((s) => (tour % 2 === 0 || !avant.has(s.nom) ? listerConteneurs(s, avecStats) : Promise.resolve(avant.get(s.nom)!))),
    ]);
    if (!avecStats) {
        for (const h of hotes) {
            const ancien = avant.get(h.nom);
            for (const c of h.conteneurs) {
                const a = ancien?.conteneurs.find((x) => x.id === c.id);
                if (a && c.enMarche) Object.assign(c, { cpu: a.cpu, memoire: a.memoire });
            }
        }
    }
    donnees.docker = hotes;
    publier();
}

// Une session qu'on vient de fermer disparaît tout de suite de l'écran, sans attendre que Claude ait fini
// de mettre ses fichiers à jour (une relecture trop tôt ne la fait pas réapparaître pendant quelques secondes)
const fermees = new Map<string, number>();
export function oublierAgent(cle: string): void {
    fermees.set(cle, Date.now());
    donnees.agents = donnees.agents.filter((a) => a.cle !== cle);
    publier(true);
}
export function annulerOubli(cle: string): void {
    fermees.delete(cle);
    rafraichirAgents();
}
const estFermee = (cle: string) => {
    const t = fermees.get(cle);
    if (t && Date.now() - t > 30_000) fermees.delete(cle);
    return !!t && Date.now() - t <= 30_000;
};

export function lireDonnees(): Donnees {
    return donnees;
}

export function rafraichirAcces(): void {
    donnees.acces = lireAcces();
    publier();
}

// Abonnement aux mises à jour (renvoie de quoi se désabonner) : pour une interface qui n'utilise pas ce hook
export function surMajDonnees(f: () => void): () => void {
    emetteur.on('maj', f);
    return () => void emetteur.off('maj', f);
}

// Hook React : se re-rend à chaque mise à jour des données
export function useDonnees(): Donnees {
    const [, setVersion] = useState(0);
    useEffect(() => surMajDonnees(() => setVersion((v) => v + 1)), []);
    return donnees;
}

// Serveur visé par une connexion active, et la session Claude qui l'a ouverte (si c'est le cas)
export function decrireConnexion(cx: ConnexionActive, d: Donnees): { serveur?: Serveur; session?: SessionActive } {
    const serveur = d.serveurs.find((s) => s.ip === cx.ip || s.noms.has(cx.ip));
    const session = d.sessions.find((s) => s.pid === cx.pid || cx.parents.includes(s.pid));
    return { serveur, session };
}
