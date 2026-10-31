import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { Projet, estWorktree } from './projets.js';
import { Hebergeur, jeton, originesGitLab, ancienGitLabPresent } from './jetons.js';
import { surPath } from './chemins.js';
import { appelGitAuthentifie } from './originesGit.js';
import { cleGitHub as lireCleGitHub } from './compteGitHub.js';
import { chargerConfig } from './config.js';
import { argumentsGitCompte } from './authGitReseau.js';

// État git de tous les projets : ce qui reste à pousser / tirer, modifs, PR

export interface PullRequest {
    numero: number;
    titre: string;
    auteur: string;
    brouillon: boolean;
    branche: string;
    url: string;
}

export interface Depot {
    projet: Projet;
    cheminGit: string;           // là où est le dépôt (le projet lui-même, ou son unique sous-dossier git)
    worktree: boolean;
    branche: string;
    amont?: string;              // branche suivie sur le remote (origin/main…)
    avance: number;              // commits à pousser
    retard: number;              // commits à tirer (selon le dernier fetch)
    modifs: number;
    dernierCommit?: { date: Date; sujet: string };
    remote?: string;
    hebergeur?: 'GitHub' | 'Azure DevOps' | 'GitLab' | 'Bitbucket' | string;
    web?: string;                // page du dépôt
    pagePR?: string;             // page des pull requests
    depot?: string;              // "owner/nom" pour GitHub
    api?: { organisation?: string; projet?: string; nom?: string; base?: string; chemin?: string };
    dernierFetch?: Date;
    prs?: PullRequest[];
}

// GIT_OPTIONAL_LOCKS=0 : « git status » ne réécrit pas .git/index (sinon la surveillance de fichiers boucle)
const ENV_GIT = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_OPTIONAL_LOCKS: '0' };

function git(args: string[], cwd: string, delai = 15_000): Promise<{ ok: boolean; sortie: string }> {
    return new Promise((ok) => {
        const proc = spawn('git', argumentsGitCompte(args), { cwd, env: ENV_GIT, windowsHide: true });
        let sortie = '', erreurs = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => (sortie += d));
        proc.stderr.on('data', (d) => (erreurs += d));
        const minuterie = setTimeout(() => proc.kill(), delai);
        proc.on('error', (e) => ok({ ok: false, sortie: e.message }));
        proc.on('close', (code) => {
            clearTimeout(minuterie);
            ok({ ok: code === 0, sortie: code === 0 ? sortie : (erreurs.trim() || sortie.trim()) });
        });
    });
}

// URL du remote → hébergeur, page web, page des PR
export function decrireRemote(url: string): Pick<Depot, 'hebergeur' | 'web' | 'pagePR' | 'depot' | 'api'> {
    const propre = url.trim().replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/').replace(/\/\/[^@/]+@/, '//');
    const github = /^https?:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(propre);
    if (github) return { hebergeur: 'GitHub', web: propre, pagePR: `${propre}/pulls`, depot: github[1] };
    // https://dev.azure.com/<organisation>/<projet>/_git/<dépôt>
    const azure = /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/.exec(propre);
    if (azure) {
        return {
            hebergeur: 'Azure DevOps', web: propre, pagePR: `${propre}/pullrequests`,
            api: { organisation: azure[1], projet: decodeURIComponent(azure[2]), nom: decodeURIComponent(azure[3]) },
        };
    }
    try {
        const u = new URL(propre);
        if (u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'gitlab.com' || originesGitLab().includes(u.origin)))
            return { hebergeur: 'GitLab', web: propre, pagePR: `${propre}/-/merge_requests`, api: { base: u.origin, chemin: u.pathname.slice(1) } };
    } catch { /* Un remote local ou inconnu n'obtient aucun jeton. */ }
    if (/bitbucket/.test(propre)) return { hebergeur: 'Bitbucket', web: propre, pagePR: `${propre}/pull-requests` };
    return { hebergeur: propre.replace(/^\w+:\/\//, '').split('/')[0], web: propre };
}

// Dossier git commun (pour un worktree : celui du dépôt principal, où vit FETCH_HEAD)
export function dossierGit(chemin: string): string {
    const p = path.join(chemin, '.git');
    if (!fs.statSync(p).isFile()) return p;
    const propre = path.resolve(chemin, fs.readFileSync(p, 'utf-8').trim().replace(/^gitdir:\s*/, ''));
    const commun = path.join(propre, 'commondir');
    return fs.existsSync(commun) ? path.resolve(propre, fs.readFileSync(commun, 'utf-8').trim()) : propre;
}

// Dossier du dépôt : le projet lui-même, ou son unique sous-dossier git (ex. API-IPG\API-IPG)
export function trouverDepot(chemin: string): string | undefined {
    if (fs.existsSync(path.join(chemin, '.git'))) return chemin;
    try {
        const sous = fs.readdirSync(chemin, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(chemin, e.name, '.git')));
        return sous.length === 1 ? path.join(chemin, sous[0].name) : undefined;
    } catch {
        return undefined;
    }
}

const derniersCommits = new Map<string, { oid: string; ok: boolean; sortie: string }>();

// URL de « origin » lue dans .git/config (même résultat que git remote get-url origin, sans processus)
function urlOrigin(dossier: string): string | undefined {
    try {
        const config = fs.readFileSync(path.join(dossier, 'config'), 'utf-8');
        const section = /^\s*\[remote\s+"origin"\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(config)?.[1] ?? '';
        return /^\s*url\s*=\s*(.+?)\s*$/m.exec(section)?.[1];
    } catch {
        return undefined;
    }
}

export async function lireDepot(projet: Projet): Promise<Depot | undefined> {
    const cheminGit = trouverDepot(projet.chemin);
    if (!cheminGit) return undefined;
    // Un seul processus git par relecture : chaque lancement fige l'interface quelques ms sous Windows.
    // Le dernier commit n'est relu que si HEAD a bougé, le remote vient de .git/config.
    const statut = await git(['status', '--porcelain=v2', '--branch'], cheminGit);
    if (!statut.ok) return undefined;
    const lignes = statut.sortie.split('\n');
    const champ = (cle: string) => lignes.find((l) => l.startsWith(`# branch.${cle} `))?.slice(`# branch.${cle} `.length);
    const ab = /\+(\d+) -(\d+)/.exec(champ('ab') ?? '');
    const oid = champ('oid') ?? '';
    let log = derniersCommits.get(cheminGit);
    if (log?.oid !== oid) {
        log = { oid, ...await git(['log', '-1', '--format=%ct%x09%s'], cheminGit) };
        derniersCommits.set(cheminGit, log);
    }
    const [ts, ...sujet] = log.sortie.trim().split('\t');
    let dernierFetch: Date | undefined;
    let dossier: string | undefined;
    try {
        dossier = dossierGit(cheminGit);
        dernierFetch = fs.statSync(path.join(dossier, 'FETCH_HEAD')).mtime;
    } catch {
        // jamais fetché
    }
    const url = dossier ? urlOrigin(dossier) : undefined;
    const remote = url ? { ok: true, sortie: url } : { ok: false, sortie: '' };
    return {
        projet,
        cheminGit,
        worktree: estWorktree(cheminGit),
        branche: champ('head') ?? '?',
        amont: champ('upstream'),
        avance: Number(ab?.[1] ?? 0),
        retard: Number(ab?.[2] ?? 0),
        modifs: lignes.filter((l) => /^[12u?] /.test(l)).length,
        dernierCommit: log.ok && ts ? { date: new Date(Number(ts) * 1000), sujet: sujet.join('\t') } : undefined,
        remote: remote.ok ? remote.sortie.trim() : undefined,
        ...(remote.ok ? decrireRemote(remote.sortie) : {}),
        dernierFetch,
    };
}

// En parallèle, par paquets (29 dépôts × 3 commandes git)
async function parPaquets<T, R>(liste: T[], taille: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const resultats: R[] = [];
    for (let i = 0; i < liste.length; i += taille) resultats.push(...await Promise.all(liste.slice(i, i + taille).map(fn)));
    return resultats;
}

export async function lireDepots(projets: Projet[]): Promise<Depot[]> {
    const depots = (await parPaquets(projets, 8, lireDepot)).filter((d): d is Depot => !!d);
    await ajouterPRs(depots);
    return depots;
}

// git fetch sur tous les dépôts (réseau) : met à jour "à tirer"
export async function fetchTout(depots: Depot[], surProgres?: (fait: number) => void): Promise<string[]> {
    const erreurs: string[] = [];
    let fait = 0;
    // Un seul fetch par dépôt réel (les worktrees partagent le même .git)
    const principaux = depots.filter((d) => !d.worktree && d.remote);
    await parPaquets(principaux, 4, async (d) => {
        const res = await git(['fetch', '--all', '--prune', '--quiet'], d.cheminGit, 60_000);
        if (!res.ok) erreurs.push(`${d.projet.nom} : ${res.sortie.split('\n')[0]}`);
        surProgres?.(++fait);
    });
    return erreurs;
}

export function pousser(d: Depot) {
    return git(d.amont ? ['push'] : ['push', '-u', 'origin', 'HEAD'], d.cheminGit, 120_000);
}

export function tirer(d: Depot) {
    return git(['pull', '--ff-only'], d.cheminGit, 120_000);
}

export async function commitsAPousser(d: Depot): Promise<string[]> {
    if (!d.amont || !d.avance) return [];
    const res = await git(['log', '--format=%h %s', '@{u}..HEAD'], d.cheminGit);
    return res.ok ? res.sortie.split('\n').filter(Boolean) : [];
}

// ─── Pull requests GitHub (via GitHub CLI, si installé et connecté) ──────────

export function etatGh(): 'absent' | 'deconnecte' | 'connecte' {
    if (!surPath('gh')) return 'absent';
    return spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', timeout: 10_000 }).status === 0 ? 'connecte' : 'deconnecte';
}

// État de la dernière lecture des PR par hébergeur (affiché dans la vue Git)
export const etatPR: Partial<Record<Hebergeur, string>> = {};

export async function appel(url: string, entetes: Record<string, string>): Promise<{ ok: boolean; statut: number; json?: any }> {
    return appelGitAuthentifie(url, entetes);
}

const raison = (statut: number) => (statut === 401 || statut === 403 ? 'jeton refusé ou sans droits' : statut === 404 ? 'introuvable (droits ?)' : statut ? `erreur ${statut}` : 'injoignable');

async function prsGitHub(depots: Depot[], cle: string, compte: string | undefined): Promise<void> {
    const entetes = { Authorization: `Bearer ${cle}`, Accept: 'application/vnd.github+json' };
    let erreur = '';
    await Promise.all(depots.map(async (d) => {
        const r = await appel(`https://api.github.com/repos/${d.depot}/pulls?state=open&per_page=50`, entetes);
        if (!r.ok) {
            erreur = raison(r.statut);
            return;
        }
        d.prs = r.json.map((p: any) => ({ numero: p.number, titre: p.title, auteur: p.user?.login ?? '', brouillon: !!p.draft, branche: p.head?.ref ?? '', url: p.html_url }));
    }));
    if (compte === chargerConfig().compteGitHub) etatPR['GitHub'] = erreur || 'ok';
}

async function prsAzure(depots: Depot[], cle: string): Promise<void> {
    const entetes = { Authorization: `Basic ${Buffer.from(':' + cle).toString('base64')}` };
    let erreur = '';
    for (const organisation of new Set(depots.map((d) => d.api!.organisation!))) {
        const r = await appel(`https://dev.azure.com/${organisation}/_apis/git/pullrequests?searchCriteria.status=active&$top=300&api-version=7.1`, entetes);
        if (!r.ok) {
            erreur = raison(r.statut);
            continue;
        }
        for (const d of depots.filter((x) => x.api!.organisation === organisation)) {
            d.prs = (r.json.value ?? [])
                .filter((p: any) => p.repository?.name === d.api!.nom && p.repository?.project?.name === d.api!.projet)
                .map((p: any) => ({ numero: p.pullRequestId, titre: p.title, auteur: p.createdBy?.displayName ?? '', brouillon: !!p.isDraft,
                    branche: String(p.sourceRefName ?? '').replace('refs/heads/', ''), url: `${d.web}/pullrequest/${p.pullRequestId}` }));
        }
    }
    etatPR['Azure DevOps'] = erreur || 'ok';
}

async function prsGitLab(depots: Depot[]): Promise<void> {
    let erreur = ancienGitLabPresent() ? 'ancien jeton à associer : /connecter gitlab' : '';
    await Promise.all(depots.map(async (d) => {
        const cle = d.api?.base ? jeton('GitLab', d.api.base) : undefined;
        if (!cle) { erreur ||= 'compte à connecter pour cette origine : /connecter gitlab'; return; }
        const r = await appel(`${d.api!.base}/api/v4/projects/${encodeURIComponent(d.api!.chemin!)}/merge_requests?state=opened&per_page=50`, { 'PRIVATE-TOKEN': cle });
        if (!r.ok) {
            erreur = raison(r.statut);
            return;
        }
        d.prs = r.json.map((p: any) => ({ numero: p.iid, titre: p.title, auteur: p.author?.username ?? '', brouillon: !!p.draft, branche: p.source_branch ?? '', url: p.web_url }));
    }));
    etatPR['GitLab'] = erreur || 'ok';
}

export async function ajouterPRs(depots: Depot[]): Promise<void> {
    const parHebergeur = (h: string) => depots.filter((d) => d.hebergeur === h && !d.worktree && (d.depot || d.api));
    const taches: Promise<void>[] = [];
    let cleGitHub: string | undefined;
    const compte = chargerConfig().compteGitHub, selectionExplicite = !!compte;
    try { if (parHebergeur('GitHub').length) cleGitHub = await lireCleGitHub(); }
    catch { if (compte === chargerConfig().compteGitHub) etatPR.GitHub = 'Compte sélectionné indisponible : /compte github'; }
    const cleAzure = jeton('Azure DevOps');
    if (cleGitHub) taches.push(prsGitHub(parHebergeur('GitHub'), cleGitHub, compte));
    if (cleAzure) taches.push(prsAzure(parHebergeur('Azure DevOps'), cleAzure));
    taches.push(prsGitLab(parHebergeur('GitLab')));
    await Promise.all(taches);
    // Les worktrees affichent les PR de leur dépôt principal
    for (const d of depots.filter((x) => x.worktree)) d.prs = depots.find((x) => !x.worktree && x.remote === d.remote)?.prs;
    if (!cleGitHub && !selectionExplicite) await prsViaGh(depots);
}

// Secours : GitHub CLI s'il est installé et connecté
async function prsViaGh(depots: Depot[]): Promise<void> {
    const github = depots.filter((d) => d.depot);
    if (!github.length || etatGh() !== 'connecte') return;
    const proprietaires = [...new Set(github.map((d) => d.depot!.split('/')[0]))];
    const args = ['search', 'prs', '--state', 'open', '--limit', '100', '--json', 'repository,number,title,author,isDraft,url',
        ...proprietaires.flatMap((p) => ['--owner', p])];
    const res = await new Promise<string>((ok) => {
        const proc = spawn('gh', args);
        let sortie = '';
        proc.stdout.on('data', (d) => (sortie += d));
        proc.on('error', () => ok('[]'));
        proc.on('close', () => ok(sortie || '[]'));
    });
    let prs: { repository: { nameWithOwner: string }; number: number; title: string; author: { login: string }; isDraft: boolean; url: string }[] = [];
    try {
        prs = JSON.parse(res);
    } catch {
        return;
    }
    for (const d of github) {
        d.prs = prs.filter((p) => p.repository.nameWithOwner.toLowerCase() === d.depot!.toLowerCase()).map((p) => ({
            numero: p.number, titre: p.title, auteur: p.author?.login ?? '', brouillon: p.isDraft, branche: '', url: p.url,
        }));
    }
}

// ─── Dépôts distants (GitHub, Azure DevOps, GitLab) ──────────────────────────
// Liste des dépôts accessibles avec les jetons, pour repérer ceux qui ne sont pas encore sur ce poste.

export interface DepotDistant {
    hebergeur: Hebergeur;
    nom: string;                 // "MonOrg/MonProjet", "Projet/Depot", "groupe/depot"
    url: string;                 // URL de clonage
    web: string;
    date?: Date;                 // dernière activité
    prive?: boolean;
}

// Même dépôt quelle que soit l'écriture de l'URL (https/ssh, utilisateur, .git, casse)
export function cleDepot(url: string): string {
    return url.trim().toLowerCase()
        .replace(/^git@([^:]+):/, '$1/')
        .replace(/^\w+:\/\//, '')
        .replace(/^[^@/]+@/, '')
        .replace(/\.git$/, '')
        .replace(/\/+$/, '');
}

export async function depotsDistants(locaux: Depot[]): Promise<DepotDistant[]> {
    const liste: DepotDistant[] = [];
    const compte = chargerConfig().compteGitHub, cleAzure = jeton('Azure DevOps');
    let cleGitHub: string | undefined;
    try { cleGitHub = await lireCleGitHub(); }
    catch { if (compte === chargerConfig().compteGitHub) etatPR.GitHub = 'Compte sélectionné indisponible : /compte github'; }
    const taches: Promise<void>[] = [];
    if (cleGitHub) {
        taches.push((async () => {
            for (let page = 1; page <= 3; page++) {
                const r = await appel(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
                    { Authorization: `Bearer ${cleGitHub}`, Accept: 'application/vnd.github+json' });
                if (!r.ok || !Array.isArray(r.json)) break;
                for (const d of r.json) {
                    if (d.archived) continue;
                    liste.push({ hebergeur: 'GitHub', nom: d.full_name, url: d.clone_url, web: d.html_url, date: new Date(d.pushed_at), prive: d.private });
                }
                if (r.json.length < 100) break;
            }
        })());
    }
    if (cleAzure) {
        const organisations = new Set(locaux.map((d) => d.api?.organisation).filter((o): o is string => !!o));
        for (const org of organisations) {
            taches.push((async () => {
                const r = await appel(`https://dev.azure.com/${org}/_apis/git/repositories?api-version=7.1`,
                    { Authorization: `Basic ${Buffer.from(':' + cleAzure).toString('base64')}` });
                for (const d of r.ok ? r.json.value ?? [] : []) {
                    if (d.isDisabled) continue;
                    liste.push({ hebergeur: 'Azure DevOps', nom: `${d.project?.name}/${d.name}`, url: d.remoteUrl, web: d.webUrl, prive: true });
                }
            })());
        }
    }
    {
        for (const base of originesGitLab()) {
            const cleGitLab = jeton('GitLab', base); if (!cleGitLab) continue;
            taches.push((async () => {
                const r = await appel(`${base}/api/v4/projects?membership=true&archived=false&per_page=100&order_by=last_activity_at`, { 'PRIVATE-TOKEN': cleGitLab });
                for (const d of r.ok && Array.isArray(r.json) ? r.json : []) {
                    liste.push({ hebergeur: 'GitLab', nom: d.path_with_namespace, url: d.http_url_to_repo, web: d.web_url, date: new Date(d.last_activity_at), prive: d.visibility !== 'public' });
                }
            })());
        }
    }
    await Promise.all(taches);
    return liste;
}

// Clone dans le dossier choisi ; le dossier du dépôt prend le nom du dépôt
export function cloner(url: string, dossierParent: string): Promise<{ ok: boolean; sortie: string; chemin: string }> {
    const nom = url.replace(/\.git$/, '').split('/').pop()!.replace(/%20/g, ' ');
    const chemin = path.join(dossierParent, nom);
    return git(['clone', url, chemin], dossierParent, 600_000).then((r) => ({ ...r, chemin }));
}
