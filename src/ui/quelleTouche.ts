// « Quelle touche ? » (which-key) : Espace dans une saisie vide ouvre la carte des actions, regroupées par thème.
// Une lettre descend dans un groupe ou lance l'action : tout est à deux touches, rien à mémoriser.

export type Feuille = { nom: string; commande: string };
export type Groupe = { nom: string; enfants: Record<string, Noeud> };
export type Noeud = Feuille | Groupe;

export const estGroupe = (n: Noeud): n is Groupe => 'enfants' in n;

// commande : une commande Agentopia, ou « espace:… » / « maitre » (gérés par l'interface)
export const ARBRE: Groupe = {
    nom: 'Actions',
    enfants: {
        l: { nom: 'Vue globale (live)', commande: '/global' },
        e: {
            nom: 'Espaces', enfants: {
                s: { nom: 'Sessions', commande: 'espace:sessions' },
                p: { nom: 'Projets', commande: 'espace:projets' },
            },
        },
        s: {
            nom: 'Sessions', enfants: {
                n: { nom: 'Nouvelle conversation', commande: '/session' },
                h: { nom: 'Historique des agents', commande: '/historique-agents' },
                f: { nom: 'Fournisseurs IA', commande: '/fournisseurs' },
                a: { nom: 'Créer une équipe mixte', commande: '/equipe-mixte' },
                q: { nom: 'Ce qu\'elles attendent', commande: '/questions' },
                m: { nom: 'Parler au maître', commande: 'maitre' },
                e: { nom: 'Équipe d\'agents', commande: '/equipe' },
                c: { nom: 'Coût Claude CLI', commande: '/cout' },
                t: { nom: 'Tâches planifiées', commande: '/planifications' },
            },
        },
        g: {
            nom: 'Git', enfants: {
                g: { nom: 'Vue Git', commande: '/git' },
                c: { nom: 'Préparer un commit', commande: '/commit' },
                r: { nom: 'Revue du diff', commande: '/revue' },
                p: { nom: 'Pull', commande: '/pull' },
                e: { nom: 'PR : corriger la revue', commande: '/pr-corriger' },
                i: { nom: 'CI : réparer', commande: '/ci-reparer' },
            },
        },
        r: {
            nom: 'Serveurs', enfants: {
                r: { nom: 'Vue SSH', commande: '/ssh' },
                f: { nom: 'Fichiers (SFTP)', commande: '/sftp' },
                a: { nom: 'Ajouter un serveur', commande: '/ssh-ajouter' },
                c: { nom: 'Installer ma clé', commande: '/ssh-cle' },
            },
        },
        d: {
            nom: 'Docker', enfants: {
                d: { nom: 'Vue Docker', commande: '/docker' },
                l: { nom: 'Surveiller des logs', commande: '/surveiller-logs' },
                s: { nom: 'Logs surveillés', commande: '/surveillances' },
            },
        },
        p: {
            nom: 'Projets', enfants: {
                p: { nom: 'Vue Projets', commande: '/projets' },
                a: { nom: 'Actions d\'un projet', commande: '' },
                r: { nom: 'Récents', commande: '/recents' },
                j: { nom: 'Journal', commande: '/journal' },
            },
        },
        o: {
            nom: 'Outils', enfants: {
                t: { nom: 'Terminal', commande: '/terminal' },
                k: { nom: 'Palette', commande: '/palette' },
                c: { nom: 'Connexions', commande: '/connexions' },
                m: { nom: 'Moniteur', commande: '/top' },
                a: { nom: 'Apparence', commande: '/apparence' },
                x: { nom: 'Exporter la config', commande: '/exporter' },
            },
        },
        '?': { nom: 'Aide', commande: '/aide' },
    },
};

export function noeudA(chemin: string): Groupe {
    let n: Groupe = ARBRE;
    for (const t of chemin) {
        const enfant = n.enfants[t];
        if (!enfant || !estGroupe(enfant)) break;
        n = enfant;
    }
    return n;
}
