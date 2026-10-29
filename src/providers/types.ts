export type Fournisseur = 'claude' | 'codex' | 'perplexity';
export const FOURNISSEURS: Record<Fournisseur, { nom: string; capacite: string }> = {
    claude: { nom: 'Claude', capacite: 'Code, fichiers et commandes · clé API Anthropic' },
    codex: { nom: 'Codex', capacite: 'Code, fichiers et commandes · connexion du CLI Codex' },
    perplexity: { nom: 'Perplexity', capacite: 'Recherche web avec sources · clé API Perplexity' },
};
export function nomAgentDefaut(f?: Fournisseur | 'choisir'): string {
    return f && f !== 'choisir' && Object.hasOwn(FOURNISSEURS, f) ? FOURNISSEURS[f].nom : 'Choisir à chaque fois';
}
export interface QuestionAgent { id: string; question: string; options?: string[] }
export interface PermissionAgent {
    id: string; titre: string; detail: string; questions?: QuestionAgent[];
}
export interface ReponsePermission { accepte: boolean; reponses?: Record<string, string> }
export interface Utilisation { entree?: number; sortie?: number; cache?: number; coutUSD?: number }
export interface SessionIntegree {
    id: string; fournisseur: Fournisseur; cwd: string; titre: string; modele?: string;
    creee: number; maj: number; tour: string; pid?: number; threadId?: string;
    etat: 'attend' | 'travaille' | 'bloquee' | 'erreur' | 'arretee';
    issue?: 'success' | 'error' | 'cancelled'; resultat?: string; erreur?: string;
    permission?: PermissionAgent; archivee?: boolean;
    dernierPrompt?: string; recuUsage?: string; utilisation?: Utilisation;
    lectureSeule?: boolean;
    compteursClaude?: Utilisation;
    compteursCodex?: Utilisation;
    bilan?: { commandes: { commande: string; codeSortie?: number }[]; fichiers?: string; resume?: string };
    origine?: { fournisseur: 'codex'; threadId: string; copieAuProchainMessage: boolean };
}
export interface EvenementAgent {
    role: 'assistant' | 'outil'; texte: string; fichier?: string;
    commande?: string; codeSortie?: number;
}
export interface ContexteAgent {
    session: SessionIntegree; prompt: string; historique: { role: 'user' | 'assistant'; content: string }[];
    signal: AbortSignal; evenement(e: EvenementAgent): void;
    thread(id: string): void;
    permission(p: Omit<PermissionAgent, 'id'>): Promise<ReponsePermission>;
    conseil?: boolean; // maître : proposer des actions, sans modifier les projets
    utilisation?(usage: Utilisation): void;
}
