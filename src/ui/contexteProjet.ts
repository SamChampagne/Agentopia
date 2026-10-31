import * as path from 'node:path';

// Le contexte est capturé avant la navigation et passé à chaque exécution :
// changer de chat pendant une commande ne change jamais son dossier.
export function dossierContexte(session?: { cwd: string }, detail?: { type: string; cle: string }, courant = process.cwd()): string {
    return path.resolve(detail?.type === 'projet' ? detail.cle : session?.cwd || courant);
}
export const hauteurComposeur = (texte: string): number => Math.min(5, Math.max(1, texte.split('\n').length));
