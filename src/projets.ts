import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { Config } from './config.js';
import { dossierSessions } from './sessions.js';

export interface Projet {
    nom: string;
    chemin: string;
    racine: string;
}

// Liste tous les projets : chaque sous-dossier des racines + les extras
export function listerProjets(config: Config): Projet[] {
    const projets: Projet[] = [];
    for (const racine of config.racines) {
        if (!fs.existsSync(racine)) continue;
        for (const entree of fs.readdirSync(racine, { withFileTypes: true })) {
            if (!entree.isDirectory() || entree.name.startsWith('.')) continue;
            projets.push({ nom: entree.name, chemin: path.join(racine, entree.name), racine });
        }
    }
    for (const extra of config.extras) {
        if (fs.existsSync(extra)) {
            projets.push({ nom: path.basename(extra), chemin: extra, racine: '(extra)' });
        }
    }
    return projets;
}

// Trouve un projet par numéro (1, 2, ...) ou par bout de nom
export function trouverProjet(projets: Projet[], cle: string): Projet | Projet[] | undefined {
    const numero = Number(cle);
    if (Number.isInteger(numero) && numero >= 1 && numero <= projets.length) {
        return projets[numero - 1];
    }
    const bas = cle.toLowerCase();
    const exact = projets.find((p) => p.nom.toLowerCase() === bas);
    if (exact) return exact;
    const partiels = projets.filter((p) => p.nom.toLowerCase().includes(bas));
    if (partiels.length === 1) return partiels[0];
    if (partiels.length > 1) return partiels;
    return undefined;
}

// Vrai dossier git ; pour un worktree, .git est un fichier "gitdir: <chemin>"
function dossierGit(chemin: string): string | undefined {
    const dossier = path.join(chemin, '.git');
    try {
        if (fs.statSync(dossier).isFile()) {
            const contenu = fs.readFileSync(dossier, 'utf-8').trim();
            return path.resolve(chemin, contenu.replace(/^gitdir:\s*/, ''));
        }
        return dossier;
    } catch {
        return undefined;
    }
}

// Dernière activité git locale : logs/HEAD bouge à chaque commit/checkout/pull
// (pas l'index, qu'un simple git status réécrit — la barre de statut le ferait passer pour récent)
export function derniereActiviteGit(chemin: string): Date | undefined {
    const dossier = dossierGit(chemin);
    try {
        if (!dossier) return undefined;
        const logs = path.join(dossier, 'logs', 'HEAD');
        return fs.statSync(fs.existsSync(logs) ? logs : path.join(dossier, 'index')).mtime;
    } catch {
        return undefined;
    }
}

// Branche git lue directement dans .git/HEAD (rapide, pas besoin de lancer git)
export function brancheGit(chemin: string): string | undefined {
    try {
        const head = fs.readFileSync(path.join(dossierGit(chemin)!, 'HEAD'), 'utf-8').trim();
        return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7);
    } catch {
        return undefined;
    }
}

// Claude stocke ses sessions dans ~/.claude/projects/<chemin encodé>/*.jsonl
export function derniereSessionClaude(chemin: string): Date | undefined {
    const dossier = dossierSessions(chemin);
    try {
        let plusRecent = 0;
        for (const fichier of fs.readdirSync(dossier)) {
            if (!fichier.endsWith('.jsonl')) continue;
            plusRecent = Math.max(plusRecent, fs.statSync(path.join(dossier, fichier)).mtimeMs);
        }
        return plusRecent ? new Date(plusRecent) : undefined;
    } catch {
        return undefined;
    }
}

export interface EtatGit {
    branche: string;
    modifs: number;
    enAvance: number;
    enRetard: number;
}

export function etatGit(chemin: string): EtatGit | undefined {
    if (!fs.existsSync(path.join(chemin, '.git'))) return undefined;
    const res = spawnSync('git', ['status', '--porcelain', '-b'], { cwd: chemin, encoding: 'utf-8' });
    if (res.status !== 0) return undefined;
    const [entete, ...lignes] = res.stdout.split('\n').filter(Boolean);
    const branche = entete.replace(/^## (No commits yet on )?/, '').split('...')[0];
    return {
        branche,
        modifs: lignes.length,
        enAvance: Number(/ahead (\d+)/.exec(entete)?.[1] ?? 0),
        enRetard: Number(/behind (\d+)/.exec(entete)?.[1] ?? 0),
    };
}

// Même chose sans bloquer l'interface (pour les rafraîchissements en continu)
export function etatGitAsync(chemin: string): Promise<EtatGit | undefined> {
    if (!fs.existsSync(path.join(chemin, '.git'))) return Promise.resolve(undefined);
    return new Promise((ok) => {
        const proc = spawn('git', ['status', '--porcelain', '-b'], { cwd: chemin, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
        let sortie = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => (sortie += d));
        proc.on('error', () => ok(undefined));
        proc.on('close', (code) => {
            if (code !== 0) return ok(undefined);
            const [entete = '', ...lignes] = sortie.split('\n').filter(Boolean);
            ok({
                branche: entete.replace(/^## (No commits yet on )?/, '').split('...')[0],
                modifs: lignes.length,
                enAvance: Number(/ahead (\d+)/.exec(entete)?.[1] ?? 0),
                enRetard: Number(/behind (\d+)/.exec(entete)?.[1] ?? 0),
            });
        });
    });
}

// Coupe et complète un texte à une largeur fixe pour aligner les colonnes
export function colonne(texte: string, largeur: number): string {
    return texte.length >= largeur ? texte.slice(0, largeur - 2) + '… ' : texte.padEnd(largeur);
}

export function depuis(date: Date): string {
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 60) return `il y a ${minutes} min`;
    const heures = Math.floor(minutes / 60);
    if (heures < 24) return `il y a ${heures} h`;
    return `il y a ${Math.floor(heures / 24)} j`;
}

// Un worktree secondaire a un fichier .git (et non un dossier)
export function estWorktree(chemin: string): boolean {
    try {
        return fs.statSync(path.join(chemin, '.git')).isFile();
    } catch {
        return false;
    }
}

// Recherche floue : les lettres tapées doivent apparaître dans l'ordre ("spl" trouve "SaniPlan-lot")
export function correspond(nom: string, terme: string): boolean {
    const t = terme.toLowerCase().replace(/\s/g, '');
    let i = 0;
    for (const ch of nom.toLowerCase()) {
        if (ch === t[i]) i++;
    }
    return i === t.length;
}
