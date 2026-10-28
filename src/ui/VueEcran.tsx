import { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { useClicsVue } from './Vues.js';
import { bus } from './bus.js';
import { calculerMise } from './mise.js';
import { Config } from '../config.js';
import { Disposition, PANNEAUX_COCKPIT, disposition, changerDisposition } from './disposition.js';
import { theme, fond } from '../theme.js';

// Disposition de l'écran : chaque réglage s'applique tout de suite (l'écran derrière change en direct)
// et l'aperçu à droite montre où va chaque chose. ↑↓ choisir · ←→, Entrée ou clic pour changer · Échap.

export type Reglage = {
    label: string;
    valeurs: { nom: string; appliquer: () => Partial<Disposition> }[];
    actuelle: (d: Disposition) => number;
    aide: string;
};
type Ligne = { section: string } | Reglage;

const panneaux = (d: Disposition, cle: string, visible: boolean) => ({
    cockpitMasques: visible ? d.cockpitMasques.filter((k) => k !== cle) : [...new Set([...d.cockpitMasques, cle])],
});

export function lignes(): Ligne[] {
    return [
        { section: 'DISPOSITION' },
        {
            label: 'Colonne des sessions', aide: 'Les cartes de session, le maître et les onglets Projets / SSH / Docker.',
            valeurs: [
                { nom: 'gauche', appliquer: () => ({ laterale: 'gauche' }) },
                { nom: 'droite', appliquer: () => ({ laterale: 'droite' }) },
                { nom: 'cachée', appliquer: () => ({ laterale: 'cachee' }) },
            ],
            actuelle: (d) => ['gauche', 'droite', 'cachee'].indexOf(d.laterale),
        },
        {
            label: 'Actions de la conversation', aide: 'Rejoindre, copier, revue, commit… quand une session est ouverte. Cachées : clic droit.',
            valeurs: [
                { nom: 'gauche', appliquer: () => ({ actions: 'gauche' }) },
                { nom: 'droite', appliquer: () => ({ actions: 'droite' }) },
                { nom: 'en haut', appliquer: () => ({ actions: 'haut' }) },
                { nom: 'cachées', appliquer: () => ({ actions: 'cachees' }) },
            ],
            actuelle: (d) => ['gauche', 'droite', 'haut', 'cachees'].indexOf(d.actions),
        },
        {
            label: 'Icônes de la barre du haut', aide: '◉ Live  ▦ Projets  ◆ Équipes… ou seulement les noms.',
            valeurs: [{ nom: 'affichées', appliquer: () => ({ icones: true }) }, { nom: 'cachées', appliquer: () => ({ icones: false }) }],
            actuelle: (d) => (d.icones ? 0 : 1),
        },
        { section: 'COCKPIT (accueil)' },
        ...PANNEAUX_COCKPIT.map((p): Reglage => ({
            label: p.nom, aide: 'Caché : les autres panneaux prennent sa place.',
            valeurs: [
                { nom: 'affiché', appliquer: () => panneaux(disposition(), p.cle, true) },
                { nom: 'caché', appliquer: () => panneaux(disposition(), p.cle, false) },
            ],
            actuelle: (d) => (d.cockpitMasques.includes(p.cle) ? 1 : 0),
        })),
    ];
}

// Petit schéma de l'écran selon la disposition
export function apercu(d: Disposition): string[] {
    const L = 44;
    const ligne = (s: string) => s.padEnd(L).slice(0, L);
    const haut = d.icones ? '✻  ◉ Live ▦ Projets ◆ Équipes ⎇ Git  ⋯' : '✻  Live  Projets  Équipes  Git  ⋯';
    const col = (t: string) => t.padEnd(10).slice(0, 10);
    const sessions = ['SESSIONS', '█ ● CLI', '  ▸ Bash', '█ ● dev', '  ? …', '', '◇ MAÎTRE'];
    const actions = ['ACTIONS', '← Retour', '↵ Rejoin.', '⎘ Code', '✓ Commit', '', 'aide…'];
    const texte = ['❯ ta demande', '', 'Réponse de', 'Claude…', '▸ Bash npm', '  ⎿ ok', ''];
    const rangees: string[] = [ligne(haut), '─'.repeat(L)];
    if (d.actions === 'haut') rangees.push(ligne(`${d.laterale === 'gauche' ? col('') + '│ ' : ''}← Retour  ↵ Rejoindre  ⎘ Code  ✓ Commit`));
    for (let i = 0; i < 7; i++) {
        const morceaux: string[] = [];
        if (d.laterale === 'gauche') morceaux.push(col(sessions[i]));
        if (d.actions === 'gauche') morceaux.push(col(actions[i]));
        morceaux.push(texte[i].padEnd(d.laterale === 'cachee' && d.actions !== 'gauche' && d.actions !== 'droite' ? 40 : 12).slice(0, 40));
        if (d.actions === 'droite') morceaux.push(col(actions[i]));
        if (d.laterale === 'droite') morceaux.push(col(sessions[i]));
        rangees.push(ligne(morceaux.join('│')));
    }
    rangees.push('─'.repeat(L), ligne('╭ ❯ saisie ─────────────────────────────╮'));
    const visibles = PANNEAUX_COCKPIT.filter((p) => !d.cockpitMasques.includes(p.cle)).map((p) => p.nom.replace(/^(Tuile|Panneau) /, '').replace(/ \(.*\)$/, ''));
    rangees.push('', 'Cockpit :', ...(visibles.length ? visibles.map((v) => `  ▪ ${v}`) : ['  (tout est caché)']));
    return rangees;
}

export function VueEcran({ fermer, config }: { fermer: () => void; config: Config }) {
    // Plein écran le temps du réglage : la place pour l'aperçu à côté de la liste
    const { stdout } = useStdout();
    const mise = calculerMise(stdout.columns || 110, stdout.rows || 34);
    const largeur = mise.largeur, hauteur = mise.corps;
    useEffect(() => {
        bus.emit('plein-ecran', true);
        return () => void bus.emit('plein-ecran', false);
    }, []);
    const toutes = lignes();
    const indexReglages = toutes.map((l, i) => ('section' in l ? -1 : i)).filter((i) => i >= 0);
    const [choix, setChoix] = useState(indexReglages[0]);
    const [, setV] = useState(0);
    const d = disposition();

    const changer = (i: number, sens: number) => {
        const r = toutes[i] as Reglage;
        const n = r.valeurs.length;
        const suivante = (r.actuelle(d) + sens + n) % n;
        changerDisposition(r.valeurs[suivante].appliquer(), config);
        setV((v) => v + 1);
    };
    useInput((input, key) => {
        const pos = indexReglages.indexOf(choix);
        if (key.upArrow) setChoix(indexReglages[(pos - 1 + indexReglages.length) % indexReglages.length]);
        if (key.downArrow || key.tab) setChoix(indexReglages[(pos + 1) % indexReglages.length]);
        if (key.rightArrow || key.return || input === ' ') changer(choix, 1);
        if (key.leftArrow) changer(choix, -1);
        if (key.escape || input === 'q') fermer();
    });
    // Ligne 0 : titre · 1 : aide · 2 : vide · 3… : les réglages
    useClicsVue((_x, y) => {
        const i = y - 3;
        if (i < 0 || i >= toutes.length || 'section' in toutes[i]) return;
        setChoix(i);
        changer(i, 1);
    });

    const largeurListe = Math.min(64, largeur - 2);
    const cote = largeur >= largeurListe + 52;
    const r = toutes[choix] as Reglage;
    return (
        <Box flexDirection="column" paddingLeft={1} width={largeur} height={hauteur}>
            <Text bold color={theme.primaire}>DISPOSITION DE L'ÉCRAN</Text>
            <Text color="gray" wrap="truncate-end">
                {'↑↓ choisir · ←→, Entrée ou clic pour changer · s’applique tout de suite · Échap pour fermer'}
            </Text>
            <Text> </Text>
            <Box flexDirection="row">
                <Box flexDirection="column" width={largeurListe} flexShrink={0}>
                    {toutes.map((l, i) => {
                        if ('section' in l) return <Text key={i} bold color={theme.secondaire}>{l.section}</Text>;
                        const actif = i === choix;
                        const v = l.actuelle(d);
                        return (
                            <Box key={i} height={1} overflow="hidden">
                                <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                                    <Text color={actif ? theme.accent : fond.texte} bold={actif}>{`${actif ? '›' : ' '} ${l.label}`.padEnd(30)}</Text>
                                    {l.valeurs.map((val, k) => (
                                        <Text key={k} color={k === v ? fond.panneau : fond.eteint} backgroundColor={k === v ? theme.accent : undefined} bold={k === v}>{` ${val.nom} `}</Text>
                                    ))}
                                </Text>
                            </Box>
                        );
                    })}
                    <Text> </Text>
                    <Text color="gray" wrap="wrap">{r?.aide}</Text>
                </Box>
                {cote && (
                    <Box flexDirection="column" marginLeft={2} borderStyle="round" borderColor={fond.bordure} paddingX={1}>
                        <Text bold color={theme.primaire}>APERÇU</Text>
                        {apercu(d).map((l, i) => <Text key={i} color={i === 0 ? theme.secondaire : fond.texte} wrap="truncate-end">{l}</Text>)}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
