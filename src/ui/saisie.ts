import { citerArgument } from '../ligneCommande.js';
import { presenterPermission } from '../presentationPermission.js';
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
    if (s.integree) return [
        { label: '← Retour', action: 'fermer', aide: 'Revenir au cockpit. Le tour continue en arrière-plan.' },
        ...(s.fournisseur === 'codex' && !s.terminalExterne && !['travaille', 'bloquee'].includes(s.statut) ? [
            { label: '↗ Ouvrir Codex', action: 'rejoindre', aide: 'Reprendre cette conversation dans un terminal Codex. Agentopia reste en lecture seule jusqu’à sa fermeture.' },
            { label: '⫿ Codex à côté', action: 'a-cote', aide: 'Reprendre la même conversation à côté dans Windows Terminal (Alt+J). Lecture seule ici tant que Codex est ouvert.' },
        ] : []),
        ...(s.permission ? [{ label: '! Répondre à l’agent', action: 'autorisation', aide: presenterPermission(s.permission).titre }] : []),
        ...(['travaille', 'bloquee'].includes(s.statut) ? [{ label: '■ Interrompre', action: 'interrompre', aide: 'Arrêter le tour. La conversation et les fichiers sont conservés.' }] : []),
        ...(!['travaille', 'bloquee'].includes(s.statut) && ['error', 'cancelled'].includes(s.issue ?? '') ? [
            { label: '↻ Reprendre', action: 'reprendre-agent', aide: 'Vérifier la connexion et relancer la dernière demande avec l’historique.' },
            { label: '⚿ Reconnecter', action: 'reconnecter', aide: 'Réparer la connexion du fournisseur, puis reprendre la demande.' },
        ] : []),
        ...(!['travaille', 'bloquee'].includes(s.statut) ? [{ label: '≡ Bilan', action: 'bilan', aide: 'Résultat, commandes observées, état Git et coût disponible.' }] : []),
        ...(s.issue === 'success' && s.resultat ? [{ label: '⇄ Passer à un agent', action: 'transmettre', aide: 'Transmettre la réponse et ses sources à Claude, Codex ou Perplexity.' }] : []),
        { label: '⎘ Copier la réponse', action: 'copier-reponse', aide: 'Copier la dernière réponse.' },
        { label: '↥ Exporter le chat', action: 'exporter', aide: 'Exporter tout l’historique en Markdown ou JSONL dans un fichier local.' },
        { label: '◇ Modèle de l’agent', action: 'modele', aide: 'Choisir le modèle utilisé pour les prochains tours de cette session.' },
        ...(s.fournisseur !== 'perplexity' ? [{ label: '± Changements', action: 'changements', aide: 'Voir les fichiers modifiés dans cette session.' }] : []),
        { label: '◧ VS Code', action: 'code', aide: 'Ouvrir ce dossier dans VS Code.' },
        { label: '▤ Dossier', action: 'dossier', aide: 'Ouvrir le dossier de cette session.' },
        { label: '❯ Terminal projet', action: 'terminal', aide: 'Ouvrir un terminal dans le dossier de cette session.' },
        { label: '✕ Archiver', action: 'fermer-session', aide: 'Interrompre et masquer la session. Son historique et ses fichiers restent sur disque.' },
    ];
    return [
        { label: '← Retour', action: 'fermer', aide: 'Revenir au cockpit. La session continue de tourner.' },
        s.arrierePlan
            ? { label: '↵ Rejoindre', action: 'rejoindre', aide: 'Ouvrir cette session dans une nouvelle fenêtre pour lui écrire directement.' }
            : { label: '⑂ Continuer ici', action: 'copie', aide: 'Reprendre cette conversation dans une nouvelle session d’arrière-plan.' },
        ...(s.arrierePlan ? [{ label: '⫿ À côté', action: 'a-cote', aide: 'Ouvrir cette session à côté de Agentopia, dans la même fenêtre Windows Terminal (Alt+J).' }] : []),
        { label: '± Changements', action: 'changements', aide: 'Les fichiers que cette session a modifiés et leur diff, prêts à commiter.' },
        { label: '⎘ Copier le code', action: 'copier-code', aide: 'Copier le dernier bloc de code de Claude dans le presse-papiers.' },
        { label: '⎘ Copier la réponse', action: 'copier-reponse', aide: 'Copier la dernière réponse de Claude dans le presse-papiers.' },
        { label: '↥ Exporter le chat', action: 'exporter', aide: 'Exporter tout l’historique dans un fichier local.' },
        { label: '⌕ Revue du diff', action: 'revue', aide: 'Faire relire les changements par l’agent choisi.' },
        { label: '✓ Commit', action: 'commit', aide: 'Commiter les changements avec un message écrit par l’agent choisi.' },
        { label: '◧ VS Code', action: 'code', aide: 'Ouvrir le dossier du projet dans VS Code.' },
        { label: '▤ Dossier', action: 'dossier', aide: 'Ouvrir le dossier du projet dans l’explorateur Windows.' },
        ...(terminaux().length ? [{ label: '❯ Terminal', action: 'terminal', aide: 'Ouvrir un terminal dans le dossier du projet.' }] : []),
        ...(s.arrierePlan ? [{ label: '★ Favori', action: 'favori', aide: 'Garder cette session en favori pour la retrouver vite.' }] : []),
        { label: '✕ Fermer la session', action: 'fermer-session', aide: 'Arrêter Claude dans cette session (elle reste reprenable plus tard).' },
    ];
}

export function commandeSession(action: string, s: SessionVue): string | undefined {
    if (action === 'exporter') return `/export-conversation ${s.sessionId}`;
    if (action === 'modele' && s.integree) return `/modele-session ${s.sessionId}`;
    if (s.integree && action === 'reconnecter') return `/fournisseurs ${s.fournisseur}`;
    if (s.integree && ['reprendre-agent', 'bilan'].includes(action)) return `/${action} ${s.sessionId}`;
    if (['autorisation', 'interrompre', 'transmettre'].includes(action) && s.integree) return `/${action} ${s.sessionId}`;
    if (action === 'copier-reponse') return `/copier-reponse ${s.sessionId}`;
    if (action === 'dossier') return `/ouvrir ${citerArgument(s.cwd)}`;
    if (action === 'terminal') return `/terminal ${terminaux()[0]?.cle ?? ''} ${citerArgument(s.cwd)}`;
    if (action === 'rejoindre') return `/rejoindre ${s.id}`;
    if (action === 'a-cote') return `/rejoindre-cote ${s.id}`;
    if (action === 'changements') return `/changements ${s.sessionId}`;
    if (action === 'fermer-session') return `/fermer ${s.id ?? s.pid}`;
    if (action === 'copie') return `/copie ${s.sessionId}`;
    if (action === 'code') return `/code ${citerArgument(s.cwd)}`;
    if (action === 'favori') return `/favori-session ${s.sessionId}`;
    if (action === 'revue') return `/revue ${citerArgument(s.cwd)}`;
    if (action === 'copier-code') return `/copier-code ${s.sessionId}`;
    if (action === 'commit') return `/commit ${citerArgument(s.cwd)}`;
    return undefined;
}

export interface Suggestion {
    texte: string;
    label: string;
    description?: string;
    executer: boolean;
}

export function calculerSuggestions(saisie: string): Suggestion[] {
    if (!saisie || saisie.includes('\n')) return [];
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
            .map((p) => ({ texte: `${mots[0]} ${citerArgument(p.chemin)} `, label: p.nom, description: p.racine, executer: true }));
    }
    return [];
}
