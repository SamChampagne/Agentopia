import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { dossierSessions } from './sessions.js';
import { surPath } from './chemins.js';

// Dossiers jamais explorés (systèmes, dépendances, caches, sorties de build)
const IGNORES = new Set([
    'node_modules', 'vendor', 'bower_components', 'packages', 'dist', 'build', 'out', 'bin', 'obj', 'target', '.next',
    'venv', '__pycache__', 'AppData', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', '$Recycle.Bin',
    'System Volume Information', 'Recovery', 'PerfLogs', 'OneDriveTemp', 'Application Data', 'Local Settings',
]);
// Fichiers qui font d'un dossier un projet
const MARQUEURS: Record<string, string> = {
    'package.json': 'Node', 'composer.json': 'PHP', 'pyproject.toml': 'Python', 'requirements.txt': 'Python',
    'pom.xml': 'Java', 'build.gradle': 'Java', 'go.mod': 'Go', 'Cargo.toml': 'Rust', 'CLAUDE.md': 'Claude',
};
const PROFONDEUR_MAX = 7;
// Sous-dossiers de librairies embarquées : un composer.json là-dedans n'est pas un projet
const DOSSIERS_LIBS = new Set(['inc', 'lib', 'libs', 'library', 'plugins', 'modules', 'third_party', 'thirdparty', 'external', 'ext', 'includes']);

export interface ProjetTrouve {
    chemin: string;
    nom: string;
    git: boolean;
    worktree: boolean;
    types: string[];
    remote?: string;
    activite: Date;             // dernière activité git (index) ou modification du dossier
    sessionsClaude: boolean;
}

function lireRemote(chemin: string): string | undefined {
    try {
        const config = fs.readFileSync(path.join(chemin, '.git', 'config'), 'utf-8');
        const url = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config)?.[1];
        return url?.replace(/^https?:\/\/[^@/]*@/, 'https://');   // on retire un éventuel jeton dans l'URL
    } catch {
        return undefined;
    }
}

function activite(chemin: string, git: boolean): Date {
    try {
        if (git) {
            const gitPath = path.join(chemin, '.git');
            const dossierGit = fs.statSync(gitPath).isFile()
                ? path.resolve(chemin, fs.readFileSync(gitPath, 'utf-8').trim().replace(/^gitdir:\s*/, ''))
                : gitPath;
            // logs/HEAD bouge à chaque commit/checkout/pull ; l'index, lui, est réécrit par un simple git status
            const logs = path.join(dossierGit, 'logs', 'HEAD');
            return fs.statSync(fs.existsSync(logs) ? logs : path.join(dossierGit, 'index')).mtime;
        }
        return fs.statSync(chemin).mtime;
    } catch {
        return new Date(0);
    }
}

// Disques fixes (C:, D:, …)
function disques(): string[] {
    const res = spawnSync('powershell', ['-NoProfile', '-Command',
        "(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3').DeviceID -join ','"], { encoding: 'utf-8', timeout: 10_000 });
    const liste = (res.stdout ?? '').trim().split(',').filter(Boolean).map((d) => d + path.sep);
    return liste.length ? liste : ['C:\\'];
}

export interface ResultatScan {
    projets: ProjetTrouve[];
    dossiersVus: number;
    duree: number;
}

// Parcours en largeur, en parallèle ; on ne descend pas dans un projet trouvé
export async function scanner(surProgres: (vus: number, trouves: number) => void): Promise<ResultatScan> {
    const debut = Date.now();
    const accueil = os.homedir().toLowerCase();
    const autresUtilisateurs = path.join(path.parse(accueil).root, 'Users').toLowerCase();
    const projets: ProjetTrouve[] = [];
    // [dossier, profondeur, dans un projet déjà trouvé]
    const file: [string, number, boolean][] = disques().map((d) => [d, 0, false]);
    let vus = 0;

    const traiter = async (dossier: string, profondeur: number, dansProjet: boolean) => {
        let entrees: fs.Dirent[];
        try {
            entrees = await fs.promises.readdir(dossier, { withFileTypes: true });
        } catch {
            return;
        }
        vus++;
        const noms = new Set(entrees.map((e) => e.name));
        const git = noms.has('.git');
        const types = Object.entries(MARQUEURS).filter(([f]) => noms.has(f)).map(([, t]) => t);
        if (entrees.some((e) => /\.(sln|csproj)$/i.test(e.name))) types.push('.NET');
        // Dans un projet, seuls les dépôts git imbriqués comptent (pas les sous-paquets ni les librairies)
        const dansLibs = DOSSIERS_LIBS.has(path.basename(path.dirname(dossier)).toLowerCase());
        if (!git && dansLibs && types.length) return;
        const estProjet = git || (types.length > 0 && !dansProjet);
        if (estProjet) {
            const worktree = git && entrees.find((e) => e.name === '.git')!.isFile();
            projets.push({
                chemin: dossier, nom: path.basename(dossier), git, worktree, types: [...new Set(types.filter((t) => t !== 'Claude'))],
                remote: git && !worktree ? lireRemote(dossier) : undefined,
                activite: activite(dossier, git),
                sessionsClaude: fs.existsSync(dossierSessions(dossier)),
            });
            // Projet non-git avec un vrai type (Node, PHP…) : ses sous-dossiers sont du code, on s'arrête.
            // Un dépôt git ou un dossier avec seulement un CLAUDE.md peut contenir d'autres dépôts : on continue.
            if (!git && types.some((t) => t !== 'Claude')) return;
        }
        if (profondeur >= PROFONDEUR_MAX) return;
        for (const e of entrees) {
            if (!e.isDirectory() || e.isSymbolicLink() || IGNORES.has(e.name) || e.name.startsWith('.') || e.name.startsWith('$')) continue;
            const enfant = path.join(dossier, e.name);
            const bas = enfant.toLowerCase();
            // Dans C:\Users, seulement son propre profil
            if (path.dirname(bas) === autresUtilisateurs && bas !== accueil) continue;
            file.push([enfant, profondeur + 1, dansProjet || estProjet]);
        }
    };

    // Jusqu'à 32 lectures de dossiers en parallèle ; la file grossit pendant le parcours
    let suivant = 0, actifs = 0;
    await new Promise<void>((fini) => {
        const lancer = () => {
            while (actifs < 32 && suivant < file.length) {
                const [dossier, profondeur, dansProjet] = file[suivant++];
                actifs++;
                traiter(dossier, profondeur, dansProjet).finally(() => {
                    actifs--;
                    if (vus % 200 === 0) surProgres(vus, projets.length);
                    lancer();
                });
            }
            if (actifs === 0 && suivant >= file.length) fini();
        };
        lancer();
    });
    return { projets: projets.sort((a, b) => a.chemin.localeCompare(b.chemin)), dossiersVus: vus, duree: Date.now() - debut };
}

// ─── Analyse du résultat ─────────────────────────────────────────────────────

export interface Groupe {
    dossier: string;            // dossier parent commun → candidat "racine"
    projets: ProjetTrouve[];
}

function nbSousDossiers(dossier: string): number {
    try {
        return fs.readdirSync(dossier, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
    } catch {
        return 0;
    }
}

// Regroupe par dossier parent. Une "racine" = chaque sous-dossier est un projet : on ne la propose
// que si au moins 2 projets ET la moitié de ses sous-dossiers en sont (sinon ~ entier deviendrait des projets)
export function grouper(projets: ProjetTrouve[]): { racines: Groupe[]; isoles: ProjetTrouve[] } {
    const parParent = new Map<string, ProjetTrouve[]>();
    projets.forEach((p) => {
        const parent = path.dirname(p.chemin);
        parParent.set(parent, [...(parParent.get(parent) ?? []), p]);
    });
    const racines: Groupe[] = [];
    const isoles: ProjetTrouve[] = [];
    for (const [dossier, liste] of parParent) {
        // Les projets imbriqués dans un autre projet (ex. SamTravail\Infor) ne font pas une racine de leur parent-projet
        const parentEstProjet = projets.some((p) => p.chemin === dossier);
        if (liste.length >= 2 && !parentEstProjet && liste.length * 2 >= nbSousDossiers(dossier)) racines.push({ dossier, projets: liste });
        else isoles.push(...liste);
    }
    return { racines: racines.sort((a, b) => b.projets.length - a.projets.length), isoles };
}

// Même dépôt cloné plusieurs fois : on garde le plus récent, les autres sont des doublons
export function doublons(projets: ProjetTrouve[]): Map<ProjetTrouve, ProjetTrouve> {
    const parRemote = new Map<string, ProjetTrouve[]>();
    projets.filter((p) => p.remote).forEach((p) => {
        const cle = p.remote!.toLowerCase().replace(/\.git$/, '');
        parRemote.set(cle, [...(parRemote.get(cle) ?? []), p]);
    });
    const resultat = new Map<ProjetTrouve, ProjetTrouve>();   // doublon → copie gardée
    for (const liste of parRemote.values()) {
        if (liste.length < 2) continue;
        const [garde, ...autres] = [...liste].sort((a, b) => b.activite.getTime() - a.activite.getTime());
        autres.forEach((a) => resultat.set(a, garde));
    }
    return resultat;
}

export function correspondFiltre(p: ProjetTrouve, filtre: string): boolean {
    const f = filtre.toLowerCase();
    if (`${p.chemin} ${p.remote ?? ''}`.toLowerCase().includes(f)) return true;
    try {
        return fs.readFileSync(path.join(p.chemin, 'package.json'), 'utf-8').toLowerCase().includes(f);
    } catch {
        return false;
    }
}

export interface Outil {
    nom: string;
    commande: string;
    present: boolean;
    installer: string;
    role: string;
}

export function outils(): Outil[] {
    const liste: Omit<Outil, 'present'>[] = [
        { nom: 'Claude Code', commande: 'claude', installer: 'npm install -g @anthropic-ai/claude-code', role: 'sessions, /ask, /commit, /revue' },
        { nom: 'Git', commande: 'git', installer: 'winget install Git.Git', role: 'branches, status, worktrees' },
        { nom: 'Windows Terminal', commande: 'wt', installer: 'winget install Microsoft.WindowsTerminal', role: 'onglets par projet' },
        { nom: 'VS Code', commande: 'code', installer: 'winget install Microsoft.VisualStudioCode', role: '/code, /cherche' },
        { nom: 'ripgrep', commande: 'rg', installer: 'winget install BurntSushi.ripgrep.MSVC', role: '/cherche, /ssh' },
        { nom: 'OpenSSH', commande: 'ssh', installer: 'Paramètres › Fonctionnalités facultatives › Client OpenSSH', role: '/ssh' },
        { nom: 'GitHub CLI', commande: 'gh', installer: 'winget install GitHub.cli', role: 'PR ouvertes' },
        { nom: 'PowerShell 7', commande: 'pwsh', installer: 'winget install Microsoft.PowerShell', role: 'onglets (sinon Windows PowerShell)' },
    ];
    return liste.map((o) => ({ ...o, present: !!surPath(o.commande) }));
}
