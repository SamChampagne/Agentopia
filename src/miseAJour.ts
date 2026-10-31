import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { surPath } from './chemins.js';
import { estDistribution, maintenirDistribution } from './distribution.js';
import { argumentsGitCompte } from './authGitReseau.js';

export interface ResultatCommande { ok: boolean; sortie: string }
export type Lanceur = (cmd: string, args: string[], cwd: string) => Promise<ResultatCommande>;
export const lancerMaintenance: Lanceur = (cmd, args, cwd) => new Promise((resoudre) => {
    const proc = spawn(cmd, cmd === 'git' ? argumentsGitCompte(args) : args, { cwd, windowsHide: true, shell: process.platform === 'win32' && cmd === 'npm', stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    const lire = (d: Buffer) => { sortie = (sortie + d.toString()).slice(-16_000); };
    proc.stdout?.on('data', lire); proc.stderr?.on('data', lire);
    proc.on('error', (e) => resoudre({ ok: false, sortie: e.message }));
    proc.on('close', (code) => resoudre({ ok: code === 0, sortie }));
});

export async function maintenirInstallation(racine: string, reparer = false, options: {
    lancer?: Lanceur; bun?: string; etape?: <T>(nom: string, fn: () => Promise<T>) => Promise<T>;
} = {}): Promise<void> {
    if (estDistribution(racine)) return maintenirDistribution(racine, reparer);
    const lancer = options.lancer ?? lancerMaintenance;
    const etape = options.etape ?? (async (_nom, fn) => fn());
    const bun = options.bun ?? surPath('bun');
    if (!bun) throw new Error('Bun manque pour l’interface actuelle. Installe-le avec winget install Oven-sh.Bun, rouvre Agentopia, puis /reparer.');
    const executer = async (nom: string, cmd: string, args: string[], cwd = racine) => {
        const r = await etape(nom, () => lancer(cmd, args, cwd));
        if (!r.ok) throw new Error(`${nom} : ${r.sortie.trim().split('\n').slice(-4).join(' · ') || 'échec'}. Corrige ce point puis relance /reparer.`);
        return r.sortie.trim();
    };
    if (!reparer) {
        if (!fs.existsSync(path.join(racine, '.git'))) throw new Error('Cette installation ne contient pas Git. Utilise /reparer pour reconstruire les sources locales.');
        const etat = await executer('Vérification des changements locaux', 'git', ['status', '--porcelain']);
        if (etat) throw new Error('Le logiciel contient des changements locaux. Enregistre-les avant /maj, ou utilise /reparer pour compiler cette version sans les remplacer.');
        await executer('Récupération des nouveautés', 'git', ['pull', '--ff-only']);
    }
    // Même si Git est déjà à jour, les dépendances et la compilation peuvent être anciennes.
    await executer('Dépendances du logiciel', 'npm', ['ci', '--no-audit', '--no-fund']);
    await executer('Compilation du logiciel', 'npm', ['run', 'build']);
    await executer('Dépendances de l’interface', bun, ['install', '--frozen-lockfile'], path.join(racine, 'tui'));
    await executer('Vérification de l’interface', process.execPath, [path.join(racine, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tui', '--noEmit']);
    const revision = await lancer('git', ['rev-parse', '--short', 'HEAD'], racine);
    const etat = await lancer('git', ['status', '--porcelain'], racine);
    fs.mkdirSync(path.join(racine, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(racine, 'dist', 'installation.json'), JSON.stringify({
        verifiee: new Date().toISOString(), revision: revision.ok ? revision.sortie.trim() : undefined,
        modificationsLocales: !etat.ok || !!etat.sortie.trim(),
    }, null, 2));
}

export async function versionInstallation(racine: string, lancer: Lanceur = lancerMaintenance): Promise<string> {
    const paquet = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8'));
    if (estDistribution(racine)) {
        const d = JSON.parse(fs.readFileSync(path.join(racine, 'distribution.json'), 'utf8'));
        return `Agentopia ${d.version} · Windows · ${d.id}\nConstruite le ${d.construite}\nDossier : ${racine}`;
    }
    const [revision, branche] = await Promise.all([
        lancer('git', ['rev-parse', '--short', 'HEAD'], racine), lancer('git', ['branch', '--show-current'], racine),
    ]);
    let verification = 'Compilation de l’installation non vérifiée · /reparer pour la vérifier';
    try {
        const r = JSON.parse(fs.readFileSync(path.join(racine, 'dist', 'installation.json'), 'utf8'));
        verification = `Dernière vérification : ${r.verifiee} · révision ${r.revision ?? 'inconnue'}${r.modificationsLocales ? ' + modifications locales' : ''}`;
    } catch { /* Installations précédentes sans reçu. */ }
    return `${paquet.name} ${paquet.version} · branche ${branche.sortie.trim() || 'détachée/inconnue'} · sources ${revision.ok ? revision.sortie.trim() : 'sans Git'}\n${verification}\nDossier : ${racine}`;
}
