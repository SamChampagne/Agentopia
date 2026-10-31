import { estFournisseur, FOURNISSEURS, type Fournisseur } from '../providers/types.js';

// La même identité dans les deux interfaces, y compris pour les sessions CLI historiques.
export function nomAgentSession(s: { fournisseur?: unknown; integree?: boolean }): string {
    if (estFournisseur(s.fournisseur)) return FOURNISSEURS[s.fournisseur].nom;
    return s.integree ? 'Agent inconnu' : 'Claude CLI';
}

export function titreConversation(s: { fournisseur?: unknown; integree?: boolean; nom: string; titre?: string }): string {
    const titre = s.titre?.trim();
    return !titre || titre === s.nom || titre === `${nomAgentSession(s)} · ${s.nom}` ? s.nom : `${s.nom} · ${titre}`;
}

export function indicationNouvelleSession(prefere?: Fournisseur | 'choisir'): string {
    return `Nouvelle session · choisir l’agent${estFournisseur(prefere) ? ` (${FOURNISSEURS[prefere].nom} proposé)` : ''}`;
}
