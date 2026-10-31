export type Fournisseur = 'claude' | 'codex' | 'perplexity';
export interface CapacitesFournisseur {
    code: boolean; fichiers: boolean; commandes: boolean; recherche: boolean;
    historiqueLocal: boolean; reprise: boolean; flux: boolean; permissions: boolean; modele: boolean;
}
const CAPACITES: Record<Fournisseur, Readonly<CapacitesFournisseur>> = {
    claude: { code: true, fichiers: true, commandes: true, recherche: true, historiqueLocal: false, reprise: true, flux: true, permissions: true, modele: true },
    codex: { code: true, fichiers: true, commandes: true, recherche: true, historiqueLocal: false, reprise: true, flux: true, permissions: true, modele: true },
    perplexity: { code: false, fichiers: false, commandes: false, recherche: true, historiqueLocal: true, reprise: false, flux: false, permissions: false, modele: false },
};
export function estFournisseur(f: unknown): f is Fournisseur { return typeof f === 'string' && Object.hasOwn(CAPACITES, f); }
export function capacitesFournisseur(f: Fournisseur): Readonly<CapacitesFournisseur> {
    if (!estFournisseur(f)) throw new Error('Fournisseur non enregistré');
    return CAPACITES[f];
}
export function validerModele(valeur: unknown): string | undefined {
    if (valeur === undefined || valeur === '') return undefined;
    if (typeof valeur !== 'string' || valeur.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(valeur)) throw new Error('Identifiant de modèle invalide (160 caractères maximum).');
    return valeur;
}
export const FOURNISSEURS: Record<Fournisseur, { nom: string; capacite: string; code: boolean }> = {
    claude: { nom: 'Claude', capacite: 'Code, fichiers et commandes · clé API Anthropic', code: CAPACITES.claude.code },
    codex: { nom: 'Codex', capacite: 'Code, fichiers et commandes · connexion du CLI Codex', code: CAPACITES.codex.code },
    perplexity: { nom: 'Perplexity', capacite: 'Recherche web avec sources · clé API Perplexity', code: CAPACITES.perplexity.code },
};
export function nomAgentDefaut(f?: Fournisseur | 'choisir'): string {
    return f && f !== 'choisir' && Object.hasOwn(FOURNISSEURS, f) ? FOURNISSEURS[f].nom : 'Choisir à chaque fois';
}
export interface QuestionAgent { id: string; question: string; options?: string[] }
export interface PermissionAgent {
    id: string; titre: string; detail: string; questions?: QuestionAgent[];
    action?: 'commande' | 'fichiers' | 'outil'; commande?: string; dossier?: string;
}
export interface ReponsePermission { accepte: boolean; reponses?: Record<string, string> }
export interface Utilisation { entree?: number; sortie?: number; cache?: number; coutUSD?: number }
export interface SessionIntegree {
    id: string; fournisseur: Fournisseur; cwd: string; titre: string; modele?: string;
    creee: number; maj: number; tour: string; pid?: number; demarragePoste?: number; threadId?: string;
    etat: 'attend' | 'travaille' | 'bloquee' | 'erreur' | 'arretee';
    issue?: 'success' | 'error' | 'cancelled'; resultat?: string; erreur?: string;
    permission?: PermissionAgent; archivee?: boolean;
    dernierPrompt?: string; recuUsage?: string; utilisation?: Utilisation;
    lectureSeule?: boolean;
    terminalExterne?: boolean;
    compteursClaude?: Utilisation;
    compteursCodex?: Utilisation;
    bilan?: { commandes: { commande: string; codeSortie?: number }[]; fichiers?: string; resume?: string;
        durees?: { travailMs: number; attenteMs: number } };
    origine?: { fournisseur: 'codex'; threadId: string; copieAuProchainMessage: boolean };
}
export interface EvenementAgent {
    role: 'assistant' | 'outil'; texte: string; fichier?: string; fichiers?: string[];
    commande?: string; codeSortie?: number;
    id?: string; etat?: 'en_cours' | 'termine' | 'erreur' | 'interrompu';
    sortie?: string; sortieTronquee?: boolean; dureeMs?: number;
}
export interface ContexteAgent {
    session: SessionIntegree; prompt: string; historique: { role: 'user' | 'assistant'; content: string }[];
    signal: AbortSignal; evenement(e: EvenementAgent): void;
    thread(id: string): void;
    permission(p: Omit<PermissionAgent, 'id'>): Promise<ReponsePermission>;
    conseil?: boolean; // maître : proposer des actions, sans modifier les projets
    utilisation?(usage: Utilisation): void;
}
