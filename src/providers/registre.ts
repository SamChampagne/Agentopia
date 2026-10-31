import { executerClaude } from './claude.js';
import { executerCodex } from './codex.js';
import { executerPerplexity } from './perplexity.js';
import { capacitesFournisseur, type ContexteAgent, type Fournisseur } from './types.js';

export type AdaptateurAgent = (contexte: ContexteAgent) => Promise<string>;
/** Point unique de raccord des transports. Les équipes consomment leurs capacités. */
export const ADAPTATEURS: Readonly<Record<Fournisseur, AdaptateurAgent>> = Object.freeze({
    claude: executerClaude, codex: executerCodex, perplexity: executerPerplexity,
});
export function executerFournisseur(contexte: ContexteAgent, registre = ADAPTATEURS): Promise<string> {
    const f = contexte.session.fournisseur;
    const capacites = capacitesFournisseur(f), executer = registre[f];
    if (!executer) throw new Error('Adaptateur de fournisseur absent');
    if (contexte.session.modele && !capacites.modele) throw new Error('Ce fournisseur choisit son modèle automatiquement. Retire le modèle personnalisé.');
    return executer(contexte);
}
