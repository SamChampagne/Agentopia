import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { gitExecution, gitVerifieAsync } from './gitExecution.js';
import { preparerWorktree } from './preparationWorktrees.js';

function git(args: string[], cwd: string): { ok: boolean; sortie: string } {
    const res = spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    return { ok: res.status === 0, sortie: (res.stdout || res.stderr || '').trim() };
}

export interface Worktree {
    chemin: string;
    branche?: string;
    principal: boolean;
}

function parserWorktrees(sortie: string): Worktree[] {
    return sortie.split('\0\0').filter(Boolean).flatMap((bloc, i) => {
        const lignes = bloc.split('\0');
        const wt = lignes.find((l) => l.startsWith('worktree '))?.slice(9);
        if (!wt) return [];
        const br = lignes.find((l) => l.startsWith('branch '))?.slice(7).replace('refs/heads/', '');
        return [{ chemin: path.normalize(wt), branche: br, principal: i === 0 }];
    });
}
export function listerWorktrees(chemin: string): Worktree[] {
    const res = git(['worktree', 'list', '--porcelain', '-z'], chemin);
    if (!res.ok) return [];
    return parserWorktrees(res.sortie);
}

// Dossier principal du dépôt (celui qui contient le vrai .git)
export function depotPrincipal(chemin: string): string | undefined {
    return listerWorktrees(chemin)[0]?.chemin;
}

export function brancheParDefaut(depot: string): string {
    const res = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], depot);
    if (res.ok) return res.sortie;
    for (const b of ['origin/main', 'origin/master', 'main', 'master']) {
        if (git(['rev-parse', '--verify', '--quiet', b], depot).ok) return b;
    }
    return 'HEAD';
}

async function principalAsync(chemin: string, signal?: AbortSignal): Promise<string> {
    const liste = await gitVerifieAsync(['worktree', 'list', '--porcelain', '-z'], chemin, { signal });
    const principal = parserWorktrees(liste)[0]?.chemin;
    if (!principal) throw new Error("Ce projet n'est pas un dépôt Git.");
    return path.normalize(principal);
}
async function defautAsync(depot: string, signal?: AbortSignal): Promise<string> {
    const r = await gitExecution(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], depot, { signal });
    if (r.ok) return r.sortie;
    for (const b of ['origin/main', 'origin/master', 'main', 'master']) {
        if ((await gitExecution(['rev-parse', '--verify', '--quiet', b], depot, { signal })).ok) return b;
    }
    return 'HEAD';
}
// Crée ../<Projet>-<fin-de-branche>. Seul le profil explicitement enregistré peut copier des fichiers ou installer des dépendances.
export async function creerWorktree(chemin: string, branche: string, base?: string, signal?: AbortSignal): Promise<{ dossier?: string; erreur?: string }> {
    let cree: string | undefined;
    try {
        const depot = await principalAsync(chemin, signal);
        await gitVerifieAsync(['check-ref-format', '--branch', branche], depot, { signal });
        const suffixe = branche.split('/').pop()!.replace(/[^a-zA-Z0-9._-]/g, '-');
        const dossier = path.join(path.dirname(depot), `${path.basename(depot)}-${suffixe}`);
        if (fs.existsSync(dossier)) return { erreur: `Le dossier existe déjà : ${dossier}` };
        await gitVerifieAsync(['fetch', '--quiet'], depot, { signal, timeoutMs: 120_000 });
        const existeLocal = (await gitExecution(['rev-parse', '--verify', '--quiet', `refs/heads/${branche}`], depot, { signal })).ok;
        const existeRemote = (await gitExecution(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branche}`], depot, { signal })).ok;
        const args = existeLocal || existeRemote
            ? ['worktree', 'add', dossier, branche]
            : ['worktree', 'add', '-b', branche, dossier, base || await defautAsync(depot, signal)];
        await gitVerifieAsync(args, depot, { signal, timeoutMs: 120_000 });
        cree = dossier;
        await preparerWorktree(depot, dossier, { signal, journal() {} });
        return { dossier };
    } catch (e) {
        return { erreur: `${e instanceof Error ? e.message : String(e)}${cree ? `\nWorktree conservé : ${cree}. Aucun agent n’a été lancé.` : ''}` };
    }
}

export interface CandidatNettoyage extends Worktree {
    merge: boolean;
    modifs: number;
}

// Worktrees secondaires avec leur état : branche mergée dans la branche par défaut ? modifs locales ?
export async function analyserWorktrees(chemin: string, signal?: AbortSignal): Promise<CandidatNettoyage[]> {
    const depot = await principalAsync(chemin, signal);
    await gitVerifieAsync(['fetch', '--prune', '--quiet'], depot, { signal, timeoutMs: 120_000 });
    const defaut = await defautAsync(depot, signal);
    const mergees = (await gitVerifieAsync(['branch', '--merged', defaut, '--format=%(refname:short)'], depot, { signal })).split('\n');
    const resultat: CandidatNettoyage[] = [];
    const liste = parserWorktrees(await gitVerifieAsync(['worktree', 'list', '--porcelain', '-z'], depot, { signal }));
    for (const wt of liste.filter((wt) => !wt.principal)) {
        const modifications = await gitVerifieAsync(['status', '--porcelain'], wt.chemin, { signal });
        resultat.push({ ...wt, merge: !!wt.branche && mergees.includes(wt.branche), modifs: modifications.split('\n').filter(Boolean).length });
    }
    return resultat;
}

// Retire le worktree puis supprime la branche locale (-d refuse si elle n'est pas mergée)
export async function supprimerWorktree(depot: string, wt: Worktree, signal?: AbortSignal): Promise<{ ok: boolean; sortie: string }> {
    const res = await gitExecution(['worktree', 'remove', wt.chemin], depot, { signal, timeoutMs: 120_000 });
    if (res.ok && wt.branche) await gitExecution(['branch', '-d', wt.branche], depot, { signal });
    return res;
}
