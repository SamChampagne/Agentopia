import { surPath } from '../chemins.js';
import { secret } from '../jetons.js';
import type { Fournisseur } from './types.js';

export function cleFournisseur(f: Fournisseur): string | undefined {
    if (f === 'codex') return undefined;
    return process.env[f === 'claude' ? 'ANTHROPIC_API_KEY' : 'PERPLEXITY_API_KEY'] || secret(`agent:${f}`);
}
export function binaireCodex(): string | undefined { return surPath('codex.exe') || surPath('codex'); }
export function disponibilite(f: Fournisseur): { pret: boolean; texte: string } {
    if (f === 'codex') return binaireCodex()
        ? { pret: true, texte: 'CLI détecté · authentification vérifiée au premier message' }
        : { pret: false, texte: 'Installe Codex CLI et connecte-le avec codex login' };
    return cleFournisseur(f)
        ? { pret: true, texte: 'Clé configurée · validité vérifiée au premier message' }
        : { pret: false, texte: `Clé API absente · /fournisseurs (${f === 'claude' ? 'Anthropic' : 'Perplexity'})` };
}
