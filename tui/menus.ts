import { terminaux } from '../dist/terminaux.js';
import { copier } from '../dist/lanceurs.js';
import { lignesJournal } from '../dist/ui/journal.js';

// Menus du clic droit : les mêmes articles que l'interface Ink (App.tsx), selon ce qui est sous la souris.
// valeur : une commande « /… » à lancer, ou une fonction de l'interface.

export type Article = { label: string; valeur: string | (() => unknown); description?: string };
export type Menu = { titre: string; articles: Article[] };

export const ici = (dossier: string): Article[] => terminaux().map((t: any) => ({ label: `❯ ${t.nom} ici`, valeur: `/terminal ${t.cle} ${dossier}` }));

export const general = (parlerAuMaitre: () => void): Article[] => [
    { label: '◈ Parler au maître (Alt+M)', valeur: parlerAuMaitre },
    { label: '⚿ Connexions (comptes, serveurs, outils)', valeur: '/connexions' },
    { label: '+ Nouvelle session Claude', valeur: '/nouvelle' },
    { label: '◆ Nouvelle équipe d\'agents', valeur: '/equipe nouvelle' },
    ...ici(process.cwd()),
];

export function menuSession(s: any, ouvrir: () => void): Menu {
    return {
        titre: `● ${s.nom} · ${s.titre || (s.arrierePlan ? s.id : 'onglet')}`,
        articles: [
            { label: '↵ Ouvrir la conversation', valeur: ouvrir },
            ...(s.arrierePlan
                ? [{ label: '⤢ Rejoindre (plein écran)', valeur: `/rejoindre ${s.id}` }, { label: '★ Mettre en favori', valeur: `/favori-session ${s.sessionId}` }]
                : [{ label: '⑂ Continuer ici', valeur: `/copie ${s.sessionId}` }]),
            { label: '⎘ Copier le dernier bloc de code', valeur: `/copier-code ${s.sessionId}` },
            { label: '⎘ Copier la dernière réponse', valeur: `/copier-reponse ${s.sessionId}` },
            { label: '⌕ Revue du diff', valeur: `/revue ${s.cwd}` },
            { label: '✓ Commit avec message IA', valeur: `/commit ${s.cwd}` },
            { label: '◧ VS Code', valeur: `/code ${s.cwd}` },
            { label: '▤ Explorateur', valeur: `/ouvrir ${s.cwd}` },
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
