import { citerArgument } from '../dist/ligneCommande.js';
import { terminaux } from '../dist/terminaux.js';
import { copier } from '../dist/lanceurs.js';
import { lignesJournal } from '../dist/ui/journal.js';
import { actionsSession, commandeSession } from '../dist/ui/saisie.js';
import { nomAgentSession } from '../dist/ui/identiteSession.js';

// Menus du clic droit : les mêmes articles que l'interface Ink (App.tsx), selon ce qui est sous la souris.
// valeur : une commande « /… » à lancer, ou une fonction de l'interface.

export type Article = { label: string; valeur: string | (() => unknown); description?: string };
export type Menu = { titre: string; articles: Article[] };

export const ici = (dossier: string): Article[] => terminaux().map((t: any) => ({ label: `❯ ${t.nom} ici`, valeur: `/terminal ${t.cle} ${dossier}` }));

export const general = (parlerAuMaitre: () => void): Article[] => [
    { label: '◈ Parler au maître (Alt+M)', valeur: parlerAuMaitre },
    { label: '⚿ Connexions (comptes, serveurs, outils)', valeur: '/connexions' },
    { label: '+ Session · choisir l’agent', valeur: '/session' },
    { label: '✦ Mission guidée', valeur: '/mission' },
    { label: '■ Tout mettre en pause', valeur: '/tout-arreter' },
    { label: '◆ Équipe avec plusieurs fournisseurs', valeur: '/equipe-mixte' },
    { label: '⚿ Configurer les fournisseurs IA', valeur: '/fournisseurs' },
    { label: '◆ Nouvelle équipe d\'agents', valeur: '/equipe nouvelle' },
    { label: '⚑ Tâche depuis un ticket', valeur: '/ticket' },
    { label: '▸ Session depuis un modèle', valeur: '/modele' },
    { label: '☀ Ma journée (résumé + coût)', valeur: '/journee' },
    { label: '$ Dépenses des 30 derniers jours', valeur: '/depenses' },    ...ici(process.cwd()),
];

export function menuSession(s: any, ouvrir: () => void): Menu {
    if (s.integree) return { titre: `${nomAgentSession(s)} · ${s.nom}`, articles: [
        { label: '↵ Ouvrir la conversation', valeur: ouvrir },
        ...actionsSession(s).filter((a) => a.action !== 'fermer').map((a) => ({ label: a.label, valeur: commandeSession(a.action, s)!, description: a.aide })),
    ] };
    return {
        titre: `● ${s.nom} · ${s.titre || (s.arrierePlan ? s.id : 'onglet')}`,
        articles: [
            { label: '↵ Ouvrir la conversation', valeur: ouvrir },
            ...(s.arrierePlan
                ? [{ label: '⤢ Rejoindre (nouvelle fenêtre)', valeur: `/rejoindre ${s.id}` }, { label: '⫿ Rejoindre à côté (Alt+J)', valeur: `/rejoindre-cote ${s.id}` },
                    { label: '★ Mettre en favori', valeur: `/favori-session ${s.sessionId}` }]
                : [{ label: '⑂ Continuer ici', valeur: `/copie ${s.sessionId}` }]),
            ...(s.statut === 'bloquee' && s.arrierePlan && s.question && !/permission/i.test(s.question)
                ? [{ label: '✎ Répondre à sa question', valeur: `/repondre ${s.sessionId}`, description: s.question }] : []),
            ...(s.statut === 'terminee' ? [{ label: '↻ Continuer (avec son historique)', valeur: `/continuer ${s.sessionId}` }] : []),
            { label: '± Voir ses changements', valeur: `/changements ${s.sessionId}` },
            { label: '⎘ Copier le dernier bloc de code', valeur: `/copier-code ${s.sessionId}` },
            { label: '⎘ Copier la dernière réponse', valeur: `/copier-reponse ${s.sessionId}` },
            { label: '⌕ Revue du diff', valeur: `/revue ${citerArgument(s.cwd)}` },
            { label: '✓ Commit avec message IA', valeur: `/commit ${citerArgument(s.cwd)}` },
            { label: '◧ VS Code', valeur: `/code ${citerArgument(s.cwd)}` },
            { label: '▤ Explorateur', valeur: `/ouvrir ${citerArgument(s.cwd)}` },
            ...ici(s.cwd),
            { label: '✕ Fermer la session', valeur: `/fermer ${s.id ?? s.pid}`, description: s.arrierePlan ? 'arrêtée et retirée (reprenable plus tard)' : 'arrête Claude dans son onglet' },
        ],
    };
}

export function menuServeur(s: any): Menu {
    return {
        titre: `Serveur ${s.nom}`,
        articles: [
            { label: `⇄ Se connecter à ${s.nom}`, valeur: `/ssh ${s.nom}` },
            { label: '⇅ Fichiers (SFTP)', valeur: `/sftp ${s.configure ? s.nom : ''}` },
            { label: '≡ Détails du serveur', valeur: `/ssh vue ${s.nom}` },
            { label: '+ Ajouter un serveur', valeur: '/ssh-ajouter' },
            { label: '⇄ Tous les serveurs', valeur: '/ssh' },
            { label: '◍ Globe des serveurs (Alt+O)', valeur: '/globe' },
        ],
    };
}

export const menuDocker = (): Menu => ({ titre: 'Docker', articles: [{ label: '▣ Ouvrir la vue Docker', valeur: '/docker' }] });

export const menuJournal = (parlerAuMaitre: () => void): Menu => ({
    titre: 'Journal',
    articles: [
        { label: '⎘ Copier le journal', valeur: () => copier(lignesJournal().join('\n').replace(/\x1b\[[0-9;]*m/g, '')) },
        { label: '− Effacer le journal', valeur: '/clear' },
        ...general(parlerAuMaitre),
    ],
});
