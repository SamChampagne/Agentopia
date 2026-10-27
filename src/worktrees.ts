import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

function git(args: string[], cwd: string): { ok: boolean; sortie: string } {
    const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
    return { ok: res.status === 0, sortie: (res.stdout || res.stderr || '').trim() };
}

export interface Worktree {
    chemin: string;
    branche?: string;
    principal: boolean;
}

export function listerWorktrees(chemin: string): Worktree[] {
    const res = git(['worktree', 'list', '--porcelain'], chemin);
    if (!res.ok) return [];
    return res.sortie.split(/\n\n+/).map((bloc, i) => {
        const lignes = bloc.split('\n');
        const wt = lignes.find((l) => l.startsWith('worktree '))!.slice(9);
        const br = lignes.find((l) => l.startsWith('branch '))?.slice(7).replace('refs/heads/', '');
        return { chemin: path.normalize(wt), branche: br, principal: i === 0 };
    });
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

// Crée ../<Projet>-<fin-de-branche> et copie les .env (non versionnés) du dépôt principal
export function creerWorktree(chemin: string, branche: string, base?: string): { dossier?: string; erreur?: string } {
    const depot = depotPrincipal(chemin);
    if (!depot) return { erreur: "Ce projet n'est pas un dépôt git." };

    const suffixe = branche.split('/').pop()!.replace(/[^a-zA-Z0-9._-]/g, '-');
    const dossier = path.join(path.dirname(depot), `${path.basename(depot)}-${suffixe}`);
    if (fs.existsSync(dossier)) return { erreur: `Le dossier existe déjà : ${dossier}` };

    git(['fetch', '--quiet'], depot);
    const existeLocal = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branche}`], depot).ok;
    const existeRemote = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branche}`], depot).ok;
    const args = existeLocal || existeRemote
        ? ['worktree', 'add', dossier, branche]
        : ['worktree', 'add', '-b', branche, dossier, base || brancheParDefaut(depot)];
    const res = git(args, depot);
    if (!res.ok) return { erreur: res.sortie };

    for (const f of fs.readdirSync(depot)) {
        if (f.startsWith('.env') && fs.statSync(path.join(depot, f)).isFile()) {
            fs.copyFileSync(path.join(depot, f), path.join(dossier, f));
        }
    }
    return { dossier };
}

export interface CandidatNettoyage extends Worktree {
    merge: boolean;
    modifs: number;
}

// Worktrees secondaires avec leur état : branche mergée dans la branche par défaut ? modifs locales ?
export function analyserWorktrees(chemin: string): CandidatNettoyage[] {
    const depot = depotPrincipal(chemin);
    if (!depot) return [];
    git(['fetch', '--prune', '--quiet'], depot);
    const defaut = brancheParDefaut(depot);
    const mergees = git(['branch', '--merged', defaut, '--format=%(refname:short)'], depot).sortie.split('\n');
    return listerWorktrees(depot)
        .filter((wt) => !wt.principal)
        .map((wt) => ({
            ...wt,
            merge: !!wt.branche && mergees.includes(wt.branche),
            modifs: git(['status', '--porcelain'], wt.chemin).sortie.split('\n').filter(Boolean).length,
        }));
}

// Retire le worktree puis supprime la branche locale (-d refuse si elle n'est pas mergée)
export function supprimerWorktree(depot: string, wt: Worktree): { ok: boolean; sortie: string } {
    const res = git(['worktree', 'remove', wt.chemin], depot);
    if (res.ok && wt.branche) git(['branch', '-d', wt.branche], depot);
    return res;
}
