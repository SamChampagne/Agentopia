import type { SessionVue } from '../agents.js';
import type { ActionSession } from './mise.js';
import { terminaux } from '../terminaux.js';
import { COMMANDES, config, getProjets, trouverCommande } from '../commandes.js';
import { projetsRecents } from '../dashboard.js';
import { correspond } from '../projets.js';

// Ce que propose la barre de saisie (suggestions) et les actions d'une session : sans Ink,
// partagé par l'interface Ink (App.tsx) et la nouvelle interface OpenTUI (tui/)

// Nouveau style : toutes les actions de la session dans sa barre, sans menu à part (le texte reste visible)
// La description s'affiche au survol (actions à gauche ou à droite)
export function actionsSession(s: SessionVue): ActionSession[] {
    return [
        { label: '← Retour', action: 'fermer', aide: 'Revenir au cockpit. La session continue de tourner.' },
        s.arrierePlan
            ? { label: '↵ Rejoindre', action: 'rejoindre', aide: 'Ouvrir cette session dans une nouvelle fenêtre pour lui écrire directement.' }
            : { label: '⑂ Continuer ici', action: 'copie', aide: 'Reprendre cette conversation dans une nouvelle session d’arrière-plan.' },
        ...(s.arrierePlan ? [{ label: '⫿ À côté', action: 'a-cote', aide: 'Ouvrir cette session à côté de Claudetopia, dans la même fenêtre Windows Terminal (Alt+J).' }] : []),
        { label: '± Changements', action: 'changements', aide: 'Les fichiers que cette session a modifiés et leur diff, prêts à commiter.' },
        { label: '⎘ Copier le code', action: 'copier-code', aide: 'Copier le dernier bloc de code de Claude dans le presse-papiers.' },
        { label: '⎘ Copier la réponse', action: 'copier-reponse', aide: 'Copier la dernière réponse de Claude dans le presse-papiers.' },
        { label: '⌕ Revue du diff', action: 'revue', aide: 'Faire relire par Claude les changements non commités du projet.' },
        { label: '✓ Commit', action: 'commit', aide: 'Commiter les changements avec un message écrit par Claude.' },
        { label: '◧ VS Code', action: 'code', aide: 'Ouvrir le dossier du projet dans VS Code.' },
        { label: '▤ Dossier', action: 'dossier', aide: 'Ouvrir le dossier du projet dans l’explorateur Windows.' },
        ...(terminaux().length ? [{ label: '❯ Terminal', action: 'terminal', aide: 'Ouvrir un terminal dans le dossier du projet.' }] : []),
        ...(s.arrierePlan ? [{ label: '★ Favori', action: 'favori', aide: 'Garder cette session en favori pour la retrouver vite.' }] : []),
        { label: '✕ Fermer la session', action: 'fermer-session', aide: 'Arrêter Claude dans cette session (elle reste reprenable plus tard).' },
    ];
}

export function commandeSession(action: string, s: SessionVue): string | undefined {
    if (action === 'copier-reponse') return `/copier-reponse ${s.sessionId}`;
    if (action === 'dossier') return `/ouvrir ${s.cwd}`;
    if (action === 'terminal') return `/terminal ${terminaux()[0]?.cle ?? ''} ${s.cwd}`;
    if (action === 'rejoindre') return `/rejoindre ${s.id}`;
    if (action === 'a-cote') return `/rejoindre-cote ${s.id}`;
    if (action === 'changements') return `/changements ${s.sessionId}`;
    if (action === 'fermer-session') return `/fermer ${s.id ?? s.pid}`;
    if (action === 'copie') return `/copie ${s.sessionId}`;
    if (action === 'code') return `/code ${s.cwd}`;
    if (action === 'favori') return `/favori-session ${s.sessionId}`;
    if (action === 'revue') return `/revue ${s.cwd}`;
    if (action === 'copier-code') return `/copier-code ${s.sessionId}`;
    if (action === 'commit') return `/commit ${s.cwd}`;
    return undefined;
}

export interface Suggestion {
    texte: string;
    label: string;
    description?: string;
    executer: boolean;
}

export function calculerSuggestions(saisie: string): Suggestion[] {
    if (!saisie) return [];
    const mots = saisie.split(' ');
    const dernier = mots[mots.length - 1];
    if (dernier.startsWith('@')) {
        return Object.entries(config.prompts)
            .filter(([nom]) => nom.startsWith(dernier.slice(1)))
            .map(([nom, texte]) => ({ texte: [...mots.slice(0, -1), `@${nom} `].join(' '), label: `@${nom}`, description: texte, executer: false }));
    }
    if (mots.length === 1 && saisie.startsWith('/')) {
        const debut = saisie.slice(1).toLowerCase();
        return COMMANDES
            .filter((cmd) => !cmd.cache && (cmd.nom.startsWith(debut) || cmd.alias?.some((a) => a.startsWith(debut))))
            .map((cmd) => ({ texte: `/${cmd.nom} `, label: `/${cmd.nom}` + (cmd.args ? ` ${cmd.args}` : ''), description: cmd.description, executer: true }));
    }
    const cmd = trouverCommande(mots[0]);
    if (cmd?.projet && mots.length === 2 && dernier !== '.') {
        const projets = getProjets();
        const recents = projetsRecents(projets, projets.length).map((r) => r.projet);
        return [...recents, ...projets.filter((p) => !recents.includes(p))]
            .filter((p) => !dernier || correspond(p.nom, dernier))
            .filter((p) => p.nom.toLowerCase() !== dernier.toLowerCase())
            .map((p) => ({ texte: `${mots[0]} ${p.nom} `, label: p.nom, description: p.racine, executer: true }));
    }
    return [];
}
