import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue, Separateur, Titre } from './Vues.js';
import { bus } from './bus.js';
import { Element, Etat, etatConnexions } from '../connexions.js';
import { theme, fond } from '../theme.js';

// Centre de connexions : tout ce qui se connecte, son état, et un clic pour le régler

const SYMBOLES: Record<Etat, { s: string; couleur: string }> = {
    ok: { s: '✓', couleur: '#4ade80' },
    avert: { s: '!', couleur: '#facc15' },
    manque: { s: '✕', couleur: '#f87171' },
    neutre: { s: '○', couleur: fond.eteint },
    verification: { s: '…', couleur: fond.eteint },
};
// Ces commandes ouvrent une vue : on n'y revient pas ensuite (les autres rouvrent ce centre une fois finies)
const VUES = new Set(['/ssh', '/docker', '/sftp']);

type Ligne = { type: 'groupe'; texte: string } | { type: 'element'; e: Element };

const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, Math.max(0, n - 2)) + '… ' : s.padEnd(n));

export function VueConnexions({ fermer }: { fermer: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const [elements, setElements] = useState<Element[]>();
    const [index, setIndex] = useState(0);

    useEffect(() => {
        let actif = true;
        etatConnexions().then((e) => actif && setElements(e)).catch(() => actif && setElements([]));
        return () => {
            actif = false;
        };
    }, []);

    const lignes: Ligne[] = [];
    for (const e of elements ?? []) {
        if (lignes.at(-1)?.type !== 'element' || (lignes.at(-1) as { e: Element }).e.groupe !== e.groupe) lignes.push({ type: 'groupe', texte: e.groupe });
        lignes.push({ type: 'element', e });
    }
    const choisissables = lignes.map((l, i) => (l.type === 'element' && l.e.commande ? i : -1)).filter((i) => i >= 0);
    // Au départ, on se place sur la première chose à régler
    const premierAFaire = lignes.findIndex((l) => l.type === 'element' && (l.e.etat === 'manque' || l.e.etat === 'avert'));
    const courant = choisissables.includes(index) ? index : (premierAFaire >= 0 ? premierAFaire : choisissables[0]);

    const aFaire = (elements ?? []).filter((e) => e.etat === 'manque' || e.etat === 'avert').length;
    const prets = (elements ?? []).filter((e) => e.etat === 'ok').length;

    const activer = (i: number) => {
        const l = lignes[i];
        if (l?.type !== 'element' || !l.e.commande) return;
        fermer();
        bus.emit('lancer', VUES.has(l.e.commande) ? l.e.commande : [l.e.commande, '/connexions']);
    };

    useClicsVue((_, y) => {
        const i = y - 3;
        if (lignes[i]?.type === 'element') activer(i);
    }, (sens) => {
        const p = choisissables.indexOf(courant);
        setIndex(choisissables[Math.max(0, Math.min(choisissables.length - 1, p - sens))]);
    });

    useInput((input, key) => {
        if (key.escape || input === 'q') return fermer();
        const p = choisissables.indexOf(courant);
        if (key.upArrow) setIndex(choisissables[Math.max(0, p - 1)]);
        if (key.downArrow) setIndex(choisissables[Math.min(choisissables.length - 1, p + 1)]);
        if (key.return) activer(courant);
    });

    const colNom = 22;
    const colAction = 20;
    const colDetail = Math.max(20, largeur - colNom - colAction - 8);

    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="⚿ CONNEXIONS" droite={!elements ? 'vérification…' : `${prets} prêt${prets > 1 ? 's' : ''}${aFaire ? ` · ${aFaire} à régler` : ' · tout est connecté'}`} />
            <Box height={1} flexShrink={0}><Text color="gray"> clic ou Entrée = régler · tout est chiffré ou stocké sur ce poste seulement · Échap fermer</Text></Box>
            <Separateur largeur={largeur - 2} />
            {!elements && <Text color="gray">  Vérification de Claude, Git, des comptes en ligne, des serveurs et des outils…</Text>}
            {lignes.slice(0, hauteur - 3).map((l, i) => {
                if (l.type === 'groupe') return <Box key={i} height={1}><Text bold color={theme.primaire}>{` ${l.texte}`}</Text></Box>;
                const actif = i === courant;
                const sym = SYMBOLES[l.e.etat];
                return (
                    <Box key={i} height={1} overflow="hidden">
                        <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                            <Text color={actif ? theme.accent : 'gray'}>{actif ? ' ❯ ' : '   '}</Text>
                            <Text color={sym.couleur}>{`${sym.s} `}</Text>
                            <Text bold={actif}>{ajuste(l.e.nom, colNom)}</Text>
                            <Text color={l.e.etat === 'ok' ? theme.secondaire : sym.couleur}>{ajuste(l.e.detail, colDetail)}</Text>
                            <Text color={l.e.etat === 'manque' || l.e.etat === 'avert' ? theme.accent : actif ? theme.accent : fond.discret}>
                                {l.e.action ? `${l.e.action} ›` : ''}
                            </Text>
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
