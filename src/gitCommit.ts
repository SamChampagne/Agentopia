import { gitExecution, gitVerifieAsync } from './gitExecution.js';

export interface EtatCommit { arbre: string; head: string; branche: string }
const lecture = { timeoutMs: 15_000 };
export async function etatCommit(cwd: string): Promise<EtatCommit> {
    const arbre = await gitVerifieAsync(['write-tree'], cwd, lecture);
    const head = await gitExecution(['rev-parse', '--verify', '--quiet', 'HEAD'], cwd, lecture);
    if (!head.ok && head.code !== 1) throw new Error('Lecture de HEAD impossible. Aucun commit créé.');
    const branche = await gitExecution(['symbolic-ref', '--quiet', 'HEAD'], cwd, lecture);
    if (!branche.ok && branche.code !== 1) throw new Error('Lecture de la branche impossible. Aucun commit créé.');
    return { arbre, head: head.ok ? (head.stdout ?? head.sortie).trim() : '', branche: branche.ok ? (branche.stdout ?? branche.sortie).trim() : '' };
}
export async function verifierEtatCommit(cwd: string, attendu: EtatCommit): Promise<void> {
    const actuel = await etatCommit(cwd);
    if (actuel.arbre !== attendu.arbre || actuel.head !== attendu.head || actuel.branche !== attendu.branche)
        throw new Error('L’index, la branche ou HEAD a changé depuis l’aperçu. Aucun commit créé. Relance /commit pour revoir les changements actuels.');
}
export async function committerEtatValide(cwd: string, attendu: EtatCommit, message: string) {
    if (!message.trim() || message.includes('\0')) throw new Error('Un message de commit non vide est requis.');
    await verifierEtatCommit(cwd, attendu);
    return gitExecution(['commit', '-F', '-'], cwd, { entree: message, timeoutMs: 120_000 });
}
