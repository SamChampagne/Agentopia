import * as fs from 'fs';
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue, Separateur, Titre } from './Vues.js';
import { bus } from './bus.js';
import { compteClaude, CompteClaude, identiteGit, cheminRaccourci } from '../configCommandes.js';
import { chargerConfig } from '../config.js';
import { jetonsConfigures } from '../jetons.js';
import { nomPalette, theme, fond } from '../theme.js';

export type LigneConfig =
    | { type: 'section'; texte: string }
    | { type: 'reglage'; label: string; valeur: string; couleur?: string; commande: string; aide: string };
type Ligne = LigneConfig;

// Ce qui est lu à l'ouverture (git et le bureau lancent des processus : une fois, pas à chaque flèche)
export const lireEtatConfig = () => ({
    config: chargerConfig(), git: identiteGit(), jetons: jetonsConfigures(), raccourci: fs.existsSync(cheminRaccourci()),
});
export type EtatConfig = ReturnType<typeof lireEtatConfig>;

const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, n - 2) + '… ' : s.padEnd(n));

export function VueConfig({ fermer }: { fermer: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const [claude, setClaude] = useState<CompteClaude>();
    const [index, setIndex] = useState(1);
    useEffect(() => {
        compteClaude().then(setClaude);
    }, []);

    const [etat] = useState(lireEtatConfig);
    const lignes = lignesConfig(etat, claude);
    const reglages = lignes.map((l, i) => (l.type === 'reglage' ? i : -1)).filter((i) => i >= 0);
    const courant = reglages.includes(index) ? index : reglages[0];

    // Lance la commande du réglage, puis rouvre ce menu
    const activer = (i: number) => {
        const l = lignes[i];
        if (l?.type !== 'reglage') return;
        fermer();
        bus.emit('lancer', [l.commande, '/config']);
    };

    useClicsVue((_, y) => {
        const i = y - 2;
        if (lignes[i]?.type === 'reglage') activer(i);
    }, (sens) => {
        const p = reglages.indexOf(courant);
        setIndex(reglages[Math.max(0, Math.min(reglages.length - 1, p - sens))]);
    });

    useInput((input, key) => {
        if (key.escape || input === 'q') return fermer();
        const p = reglages.indexOf(courant);
        if (key.upArrow) setIndex(reglages[Math.max(0, p - 1)]);
        if (key.downArrow) setIndex(reglages[Math.min(reglages.length - 1, p + 1)]);
        if (key.return) activer(courant);
    });

    const colLabel = 26;
    const colValeur = Math.max(20, largeur - colLabel - 30);

    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="CONFIGURATION" droite="clic ou Entrée = modifier · Échap fermer" />
            <Separateur largeur={largeur - 2} />
            {lignes.slice(0, hauteur - 2).map((l, i) => {
                if (l.type === 'section') {
                    return <Box key={i} height={1}><Text bold color={theme.primaire}>{` ${l.texte}`}</Text></Box>;
                }
                const actif = i === courant;
                return (
                    <Box key={i} height={1} overflow="hidden">
                        <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                            <Text color={actif ? theme.accent : 'gray'}>{actif ? ' ❯ ' : '   '}</Text>
                            {ajuste(l.label, colLabel)}
                            <Text color={l.couleur ?? theme.secondaire}>{ajuste(l.valeur, colValeur)}</Text>
                            <Text color={actif ? theme.accent : fond.discret}>{`${l.aide} ›`}</Text>
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}

// Les réglages affichés, pour l'interface Ink comme pour la nouvelle (tui/)
export function lignesConfig({ config, git, jetons, raccourci }: EtatConfig, claude?: CompteClaude): LigneConfig[] {
    return [
        { type: 'section', texte: 'COMPTES' },
        { type: 'reglage', label: '⚿ Connexions', valeur: 'tout voir et tout connecter au même endroit', couleur: theme.accent, commande: '/connexions', aide: 'ouvrir' },
        {
            type: 'reglage', label: 'Claude', commande: '/compte claude', aide: 'changer de compte',
            valeur: !claude ? 'lecture…' : claude.connecte ? `${claude.email ?? ''} (${claude.methode ?? ''})` : 'non connecté',
            couleur: claude && !claude.connecte ? '#f87171' : undefined,
        },
        {
            type: 'reglage', label: 'Git (commits)', commande: '/compte git', aide: 'modifier',
            valeur: git.nom || git.email ? `${git.nom} <${git.email}>` : 'non configuré', couleur: git.nom ? undefined : '#facc15',
        },
        ...(['GitHub', 'Azure DevOps', 'GitLab'] as const).map((h): Ligne => ({
            type: 'reglage', label: h, commande: '/jetons', aide: jetons.includes(h) ? 'remplacer le jeton' : 'ajouter un jeton',
            valeur: jetons.includes(h) ? 'jeton enregistré (pull requests visibles)' : 'aucun jeton', couleur: jetons.includes(h) ? '#4ade80' : 'gray',
        })),
        { type: 'section', texte: 'INTERFACE' },
        { type: 'reglage', label: 'Disposition de l’écran', valeur: 'sessions, actions, icônes, panneaux du cockpit', commande: '/ecran', aide: 'régler (avec aperçu)' },
        { type: 'reglage', label: 'Assistant de départ', valeur: 'prénom, disposition, thème, sessions, projets, connexions', commande: '/bienvenue', aide: 'relancer' },
        { type: 'reglage', label: 'Thème', valeur: nomPalette(), couleur: theme.accent, commande: '/theme', aide: 'changer' },
        { type: 'reglage', label: 'Apparence du terminal', valeur: 'couleurs, police, transparence (profil Windows Terminal)', commande: '/apparence', aide: 'choisir' },
        { type: 'reglage', label: 'Cartes de session', valeur: config.cartesDetaillees ? 'détaillées (3 lignes)' : 'compactes (2 lignes)', commande: `/cartes ${config.cartesDetaillees ? 'compactes' : 'detaillees'}`, aide: 'basculer' },
        { type: 'reglage', label: 'Nom en haut à gauche', valeur: (config.banniere || 'CLAUDETOPIA').toUpperCase(), commande: '/nom', aide: 'modifier' },
        { type: 'reglage', label: 'Prénom', valeur: config.prenom || '(non défini)', commande: '/prenom', aide: 'modifier' },
        { type: 'reglage', label: 'Colonne de gauche', valeur: config.largeurLaterale ? `${config.largeurLaterale} colonnes` : 'automatique', commande: '/largeur', aide: 'changer (ou glisse la ligne)' },
        { type: 'section', texte: 'SESSIONS CLAUDE' },
        {
            type: 'reglage', label: 'Nouvelles sessions', valeur: config.lancement === 'fond' ? 'en arrière-plan (cartes, joignables)' : 'dans un onglet',
            commande: `/lancement ${config.lancement === 'fond' ? 'onglet' : 'fond'}`, aide: 'basculer',
        },
        {
            type: 'reglage', label: 'Notifications', valeur: config.notifications ? 'activées' : 'désactivées', couleur: config.notifications ? '#4ade80' : 'gray',
            commande: `/notifs ${config.notifications ? 'off' : 'on'}`, aide: 'basculer',
        },
        { type: 'reglage', label: 'Prompts favoris', valeur: Object.keys(config.prompts).map((p) => `@${p}`).join(' '), commande: '/prompts', aide: 'voir' },
        { type: 'section', texte: 'POSTE' },
        { type: 'reglage', label: 'Projets suivis', valeur: `${config.racines.length} dossier(s) + ${config.extras.length} projet(s)`, commande: '/scan', aide: 'rescanner le poste' },
        { type: 'reglage', label: 'Docker distant', valeur: config.dockerDistant.length ? config.dockerDistant.join(', ') : 'aucun serveur', commande: '/ssh', aide: 'choisir dans la vue SSH' },
        { type: 'reglage', label: 'Raccourci bureau', valeur: raccourci ? 'présent' : 'absent', couleur: raccourci ? '#4ade80' : '#facc15', commande: '/raccourci', aide: raccourci ? 'recréer' : 'créer' },
        { type: 'reglage', label: 'Diagnostic', valeur: 'vérifie que tout fonctionne', commande: '/diagnostic', aide: 'lancer' },
        { type: 'reglage', label: 'Fichier de configuration', valeur: '~/.claudetopia.json', commande: '/fichier-config', aide: 'ouvrir dans VS Code' },
    ];
}
