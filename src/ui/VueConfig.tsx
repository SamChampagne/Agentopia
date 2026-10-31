import * as fs from 'fs';
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue, Separateur, Titre } from './Vues.js';
import { bus } from './bus.js';
import { compteClaude, CompteClaude, identiteGit, cheminRaccourci } from '../configCommandes.js';
import { chargerConfig, etatRecuperationConfig } from '../config.js';
import { jetonsConfigures } from '../jetons.js';
import { nomPalette, theme, fond } from '../theme.js';
import { FOURNISSEURS, nomAgentDefaut } from '../providers/types.js';
import { lirePreparation, projetsIgnores } from '../preparation.js';
import { problemesSessions } from '../stockageSessions.js';
import { etatCompteGitHub, type EtatCompteGitHub } from '../compteGitHub.js';

export type LigneConfig =
    | { type: 'section'; texte: string }
    | { type: 'reglage'; label: string; valeur: string; couleur?: string; commande: string; aide: string };
type Ligne = LigneConfig;

// Ce qui est lu à l'ouverture (git et le bureau lancent des processus : une fois, pas à chaque flèche)
export const lireEtatConfig = () => ({
    config: chargerConfig(), git: identiteGit(), jetons: jetonsConfigures(), raccourci: fs.existsSync(cheminRaccourci()),
    preparation: lirePreparation(),
    sessionsIllisibles: problemesSessions().length,
});
export type EtatConfig = ReturnType<typeof lireEtatConfig>;

const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, n - 2) + '… ' : s.padEnd(n));

export function VueConfig({ fermer }: { fermer: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const [claude, setClaude] = useState<CompteClaude>();
    const [github, setGitHub] = useState<EtatCompteGitHub>();
    const [index, setIndex] = useState(1);
    useEffect(() => {
        compteClaude().then(setClaude);
        void etatCompteGitHub().then(setGitHub);
    }, []);

    const [etat] = useState(lireEtatConfig);
    const lignes = lignesConfig(etat, claude, github);
    const reglages = lignes.map((l, i) => (l.type === 'reglage' ? i : -1)).filter((i) => i >= 0);
    const courant = reglages.includes(index) ? index : reglages[0];
    const visibles = Math.max(1, hauteur - 2);
    const debut = Math.max(0, Math.min(courant - Math.floor(visibles / 2), lignes.length - visibles));

    // Lance la commande du réglage, puis rouvre ce menu
    const activer = (i: number) => {
        const l = lignes[i];
        if (l?.type !== 'reglage') return;
        fermer();
        bus.emit('lancer', [l.commande, '/config']);
    };

    useClicsVue((_, y) => {
        const i = y - 2 + debut;
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
            {lignes.slice(debut, debut + visibles).map((l, relatif) => {
                const i = debut + relatif;
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
export function lignesConfig({ config, git, jetons, raccourci, preparation, sessionsIllisibles = 0 }: EtatConfig, claude?: CompteClaude, github?: EtatCompteGitHub): LigneConfig[] {
    const projetsReportes = preparation ? projetsIgnores(preparation, config).length : 0;
    return [
        ...(etatRecuperationConfig() ? [{ type: 'reglage' as const, label: 'Réglages récupérés', valeur: etatRecuperationConfig()!.message, couleur: '#facc15', commande: '/diagnostic', aide: 'voir la sauvegarde' }] : []),
        { type: 'section', texte: 'COMPTES' },
        { type: 'reglage', label: 'Fournisseurs IA', valeur: Object.values(FOURNISSEURS).map((f) => f.nom).join(', '), commande: '/fournisseurs', aide: 'connecter et vérifier' },
        { type: 'reglage', label: '⚿ Connexions', valeur: 'tout voir et tout connecter au même endroit', couleur: theme.accent, commande: '/connexions', aide: 'ouvrir' },
        {
            type: 'reglage', label: 'Compte Claude CLI', commande: '/compte claude', aide: 'changer (CLI uniquement)',
            valeur: !claude ? 'lecture…' : claude.connecte ? `${claude.email ?? ''} (${claude.methode ?? ''})` : 'non connecté',
            couleur: claude && !claude.connecte ? '#f87171' : undefined,
        },
        {
            type: 'reglage', label: 'Git (commits)', commande: '/compte git', aide: 'modifier',
            valeur: git.nom || git.email ? `${git.nom} <${git.email}>` : 'non configuré', couleur: git.nom ? undefined : '#facc15',
        },
        { type: 'reglage', label: 'Compte GitHub', commande: '/compte github', aide: 'choisir un compte local',
            valeur: github?.texte || (config.compteGitHub ? `@${config.compteGitHub} · vérification…` : 'Choisir parmi les comptes de ce poste'),
            couleur: github?.ok ? '#4ade80' : github ? '#facc15' : undefined },
        ...(['Azure DevOps', 'GitLab'] as const).map((h): Ligne => ({
            type: 'reglage', label: h, commande: '/jetons', aide: jetons.includes(h) ? 'remplacer le jeton' : 'ajouter un jeton',
            valeur: jetons.includes(h) ? 'jeton enregistré (pull requests visibles)' : 'aucun jeton', couleur: jetons.includes(h) ? '#4ade80' : 'gray',
        })),
        { type: 'section', texte: 'INTERFACE' },
        { type: 'reglage', label: 'Disposition de l’écran', valeur: 'sessions, actions, icônes, panneaux du cockpit', commande: '/ecran', aide: 'régler (avec aperçu)' },
        { type: 'reglage', label: 'Préparer le poste', valeur: 'projets, agents et choix conservés', commande: '/preparer', aide: 'reprendre ou revoir' },
        { type: 'reglage', label: 'Thème', valeur: nomPalette(), couleur: theme.accent, commande: '/theme', aide: 'changer' },
        { type: 'reglage', label: 'Apparence du terminal', valeur: 'couleurs, police, transparence (profil Windows Terminal)', commande: '/apparence', aide: 'choisir' },
        { type: 'reglage', label: 'Cartes de session', valeur: config.cartesDetaillees ? 'détaillées (3 lignes)' : 'compactes (2 lignes)', commande: `/cartes ${config.cartesDetaillees ? 'compactes' : 'detaillees'}`, aide: 'basculer' },
        { type: 'reglage', label: 'Nom en haut à gauche', valeur: (config.banniere || 'AGENTOPIA').toUpperCase(), commande: '/nom', aide: 'modifier' },
        { type: 'reglage', label: 'Prénom', valeur: config.prenom || '(non défini)', commande: '/prenom', aide: 'modifier' },
        { type: 'reglage', label: 'Colonne de gauche', valeur: config.largeurLaterale ? `${config.largeurLaterale} colonnes` : 'automatique', commande: '/largeur', aide: 'changer (ou glisse la ligne)' },
        { type: 'section', texte: 'AGENTS ET SESSIONS' },
        { type: 'reglage', label: 'Modèles d’équipe', valeur: 'réutiliser les missions, agents et dépendances', commande: '/modeles-equipes', aide: 'voir et gérer' },
        { type: 'reglage', label: 'Moteur des équipes', valeur: 'continuer le travail en arrière-plan · pause globale', commande: '/moteur', aide: 'voir et contrôler' },
        { type: 'reglage', label: 'File globale des agents', valeur: 'travaux en attente et raisons de l’attente', commande: '/file-agents', aide: 'voir ou annuler' },
        { type: 'reglage', label: 'Capacité des équipes', valeur: 'nombre d’agents en parallèle sur ce poste', commande: '/limites-equipes', aide: 'régler' },
        { type: 'reglage', label: 'Préparation des projets', valeur: 'commandes des copies de travail et fichiers autorisés', commande: '/preparation-projet', aide: 'configurer' },
        { type: 'reglage', label: 'Utilisation des agents', valeur: 'tours, jetons et coûts disponibles du jour', commande: '/utilisation', aide: 'voir le détail' },
        { type: 'reglage', label: 'Limites des agents', valeur: `${config.limitesAgents?.toursJour || 'illimité'} tours/jour · ${config.limitesAgents?.dureeMinutes ?? 60} min/tour`, commande: '/limites-agents', aide: 'régler' },
        { type: 'reglage', label: 'Tâches planifiées', valeur: 'agent choisi · exécution par le moteur', commande: '/planifications', aide: 'gérer' },
        { type: 'reglage', label: 'Agents à utiliser', valeur: 'détecter, installer et connecter tes agents', commande: '/choisir-agents', aide: 'choisir' },
        ...(preparation?.ignores.length ? [{ type: 'reglage' as const, label: 'Agents reportés', valeur: preparation.ignores.map((f) => FOURNISSEURS[f].nom).join(', '), commande: '/preparer agents', aide: 'revoir mes choix' }] : []),
        { type: 'reglage', label: 'Agent par défaut', valeur: nomAgentDefaut(config.fournisseurDefaut), commande: '/agent-defaut', aide: 'proposé avant création' },
        { type: 'reglage', label: 'Agent maître', valeur: config.maitre.fournisseur === 'claude-cli' ? 'Claude CLI' : config.maitre.fournisseur && config.maitre.fournisseur !== 'auto' ? nomAgentDefaut(config.maitre.fournisseur) : 'Automatique · à la demande', commande: '/maitre-fournisseur', aide: 'organiser le travail' },
        { type: 'reglage', label: 'Historique des agents', valeur: 'conversations créées ici, tous fournisseurs', commande: '/historique-agents', aide: 'reprendre' },
        { type: 'reglage', label: 'Chercher une conversation', valeur: 'messages anciens, sessions actives et archivées', commande: '/chercher-conversations', aide: 'rechercher' },
        {
            type: 'reglage', label: 'Lancement Claude CLI', valeur: config.lancement === 'fond' ? 'en arrière-plan (sessions natives)' : 'dans un onglet (sessions natives)',
            commande: `/lancement ${config.lancement === 'fond' ? 'onglet' : 'fond'}`, aide: 'CLI uniquement',
        },
        {
            type: 'reglage', label: 'Notifications', valeur: config.notifications ? 'activées' : 'désactivées', couleur: config.notifications ? '#4ade80' : 'gray',
            commande: `/notifs ${config.notifications ? 'off' : 'on'}`, aide: 'basculer',
        },
        { type: 'reglage', label: 'Prompts favoris', valeur: Object.keys(config.prompts).map((p) => `@${p}`).join(' '), commande: '/prompts', aide: 'voir' },
        { type: 'section', texte: 'SAUVEGARDE ET RÉCUPÉRATION' },
        { type: 'reglage', label: 'Sauvegarder Agentopia', valeur: 'réglages, conversations, équipes et preuves', commande: '/sauvegarder', aide: 'créer une copie' },
        { type: 'reglage', label: 'Restaurer une sauvegarde', valeur: 'prévisualisation puis restauration en pause', commande: '/restaurer-sauvegarde', aide: 'choisir' },
        { type: 'reglage', label: 'Sessions à récupérer', valeur: sessionsIllisibles ? `${sessionsIllisibles} état(s) illisible(s) · conversations conservées` : 'aucune session illisible détectée', couleur: sessionsIllisibles ? '#facc15' : undefined, commande: '/recuperer-sessions', aide: 'examiner' },
        { type: 'reglage', label: 'Récupérer les connexions', valeur: 'dernière copie chiffrée du coffre sur ce compte', commande: '/recuperer-coffre', aide: 'restaurer' },
        { type: 'reglage', label: 'Annuler un import', valeur: 'récupérer les réglages et SSH précédents', commande: '/recuperer-importation', aide: 'vérifier' },
        { type: 'reglage', label: 'Annuler une restauration', valeur: 'récupérer les fichiers précédents si inchangés', commande: '/annuler-restauration', aide: 'vérifier' },
        { type: 'section', texte: 'POSTE' },
        { type: 'reglage', label: 'Projets suivis', valeur: `${config.racines.length} dossier(s) + ${config.extras.length} projet(s)`, commande: '/scan', aide: 'rescanner le poste' },
        ...(projetsReportes ? [{ type: 'reglage' as const, label: 'Projets ignorés', valeur: `${projetsReportes} projet(s) laissés de côté au dernier choix`, commande: '/preparer projets', aide: 'revoir sans retirer' }] : []),
        { type: 'reglage', label: 'Docker distant', valeur: config.dockerDistant.length ? config.dockerDistant.join(', ') : 'aucun serveur', commande: '/ssh', aide: 'choisir dans la vue SSH' },
        { type: 'reglage', label: 'Raccourci bureau', valeur: raccourci ? 'présent' : 'absent', couleur: raccourci ? '#4ade80' : '#facc15', commande: '/raccourci', aide: raccourci ? 'recréer' : 'créer' },
        { type: 'reglage', label: 'Diagnostic', valeur: 'vérifie que tout fonctionne', commande: '/diagnostic', aide: 'lancer' },
        { type: 'reglage', label: 'Exporter le diagnostic', valeur: 'rapport local sans conversation ni secret', commande: '/diagnostics', aide: 'prévisualiser' },
        { type: 'reglage', label: 'Version installée', valeur: 'version, branche, révision et dernière vérification', commande: '/version', aide: 'voir' },
        { type: 'reglage', label: 'Mise à jour', valeur: 'vérifier et installer la version disponible', commande: '/maj', aide: 'mettre à jour' },
        { type: 'reglage', label: 'Réparer l’installation', valeur: 'restaurer le logiciel en conservant tes données', commande: '/reparer', aide: 'réparer' },
        ...(process.env.AGENTOPIA_DISTRIBUTION_ROOT ? [{ type: 'reglage' as const, label: 'Version précédente', valeur: 'revenir à la version Windows conservée', commande: '/retour-version', aide: 'revenir' }] : []),
        ...(process.env.AGENTOPIA_DISTRIBUTION_ROOT ? [
            { type: 'reglage' as const, label: 'Entretien de l’installation', valeur: 'espace occupé et anciennes versions nettoyables', commande: '/espace-installation', aide: 'examiner' },
            { type: 'reglage' as const, label: 'Désinstaller Agentopia', valeur: 'conserve tes données, projets et comptes', commande: '/desinstaller', aide: 'ouvrir le retrait' },
        ] : []),
        { type: 'reglage', label: 'Fichier de configuration', valeur: '~/.claudetopia.json', commande: '/fichier-config', aide: 'ouvrir dans VS Code' },
    ];
}
