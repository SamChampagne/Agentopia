import * as path from 'path';
import type { Donnees } from './donnees.js';
import { depotDe, lireSynchro } from '../synchro.js';
import { theme, couleurProjet, fond } from '../theme.js';
import type { Projet } from '../projets.js';

// Espaces de travail de la colonne de gauche : Sessions ou Projets (Docker et SSH restent en bas de la colonne)

export type Espace = 'sessions' | 'projets';
export const ESPACES: { cle: Espace; label: string }[] = [
    { cle: 'sessions', label: 'Sessions' },
    { cle: 'projets', label: 'Projets' },
];

// Position des onglets (ligne 0 de la colonne) : marge de 1, puis libellé + 2 espaces
export function ongletsPositions(): { cle: Espace; x: number; largeur: number }[] {
    let x = 1;
    return ESPACES.map((e) => {
        const o = { cle: e.cle, x, largeur: e.label.length };
        x += e.label.length + 2;
        return o;
    });
}

export type Detail = { type: 'projet' | 'serveur' | 'conteneur'; cle: string };
export type Morceau = { t: string; c?: string; gras?: boolean };

export interface LigneEspace {
    cle: string;               // identifiant de la ligne (survol, sélection)
    morceaux: Morceau[];
    droite?: string;
    couleurDroite?: string;
    titre?: boolean;           // en-tête de groupe (pas de fond)
    detail?: Detail;           // ce que le clic ouvre
    commande?: string;         // ou la commande qu'il lance
}

const etatCourt = (chemin: string): string => {
    const d = depotDe(chemin);
    if (!d) return '';
    return [d.modifs ? `✎${d.modifs}` : '', d.retard ? `↓${d.retard}` : '', d.avance ? `↑${d.avance}` : ''].filter(Boolean).join(' ') || '✓';
};

export function lignesEspace(espace: Espace, d: Donnees, projets: Projet[]): LigneEspace[] {
    if (espace !== 'projets') return [];
    // Les plus actifs d'abord (dernier commit), une session Claude en cours marquée ✻
    const date = (p: Projet) => depotDe(p.chemin)?.dernierCommit?.date.getTime() ?? 0;
    return [...projets].sort((a, b) => date(b) - date(a)).map((p) => {
        const d2 = depotDe(p.chemin);
        const sessions = d.agents.filter((a) => path.resolve(a.cwd).toLowerCase().startsWith(path.resolve(p.chemin).toLowerCase())).length;
        const etat = etatCourt(p.chemin);
        return {
            cle: `projet:${p.chemin}`,
            morceaux: [{ t: '● ', c: couleurProjet(p.nom) }, { t: p.nom, gras: true, c: fond.texte }, { t: sessions ? `  ✻${sessions}` : '', c: theme.accent }],
            droite: d2 ? `⎇ ${d2.branche.length > 14 ? d2.branche.slice(0, 13) + '…' : d2.branche} ${etat}` : '',
            couleurDroite: etat === '✓' ? fond.discret : '#facc15',
            detail: { type: 'projet', cle: p.chemin },
        };
    });
}

export const totalSynchro = () => lireSynchro().depots.length;
