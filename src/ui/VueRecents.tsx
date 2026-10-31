import { citerArgument } from '../ligneCommande.js';
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue, Separateur, Titre } from './Vues.js';
import { bus } from './bus.js';
import { ilYa } from './Panneau.js';
import { useProjets } from './projets.js';
import { projetsRecents } from '../dashboard.js';
import { Projet, EtatGit, etatGit } from '../projets.js';
import { depotDe } from '../synchro.js';
import { etatLisible as etatDepot } from './VueProjets.js';
import { theme, couleurProjet, fond } from '../theme.js';

interface Ligne {
    projet: Projet;
    date: Date;
    git?: EtatGit;
}

const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, n - 2) + '… ' : s.padEnd(n));

// État git en mots plutôt qu'en symboles
function etatLisible(g?: EtatGit): { texte: string; couleur: string } {
    if (!g) return { texte: 'pas un dépôt git', couleur: fond.eteint };
    const morceaux = [
        g.enRetard ? `${g.enRetard} à tirer` : '',
        g.enAvance ? `${g.enAvance} à pousser` : '',
        g.modifs ? `${g.modifs} fichier${g.modifs > 1 ? 's' : ''} modifié${g.modifs > 1 ? 's' : ''}` : '',
    ].filter(Boolean);
    if (!morceaux.length) return { texte: 'à jour', couleur: '#4ade80' };
    return { texte: morceaux.join(' · '), couleur: g.enRetard ? '#f87171' : '#facc15' };
}

export function VueRecents({ fermer }: { fermer: () => void }) {
    const projets = useProjets();
    const { largeur, hauteur } = useTailleVue();
    const [lignes, setLignes] = useState<Ligne[]>();
    const [index, setIndex] = useState(0);

    // La lecture git (une commande par projet) se fait après le premier affichage
    useEffect(() => {
        const t = setTimeout(() => {
            setLignes(projetsRecents(projets, Math.max(5, hauteur - 5)).map(({ projet, date }) => ({ projet, date, git: etatGit(projet.chemin) })));
        }, 20);
        return () => clearTimeout(t);
    }, [projets, hauteur]);

    const ouvrir = (l?: Ligne) => {
        if (!l) return;
        fermer();
        bus.emit('lancer', `/actions ${citerArgument(l.projet.chemin)}`);
    };

    useClicsVue((_, y) => {
        const i = y - 3;
        if (lignes?.[i]) {
            setIndex(i);
            ouvrir(lignes[i]);
        }
    }, (sens) => setIndex((i) => Math.max(0, Math.min((lignes?.length ?? 1) - 1, i - sens))));

    useInput((input, key) => {
        if (key.escape || input === 'q') return fermer();
        if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
        if (key.downArrow) setIndex((i) => Math.min((lignes?.length ?? 1) - 1, i + 1));
        if (key.return) ouvrir(lignes?.[index]);
    });

    const largeurNom = Math.min(28, Math.max(16, Math.floor(largeur * 0.25)));

    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="PROJETS RÉCENTS" droite="clic = actions du projet · Échap fermer" />
            <Box height={1} flexShrink={0}>
                <Text color="gray">{'  ' + ajuste('Projet', largeurNom) + ajuste('Activité', 15) + ajuste('Branche', 32) + 'État'}</Text>
            </Box>
            <Separateur largeur={largeur - 2} />
            {!lignes && <Text color="gray">  lecture de l'état git…</Text>}
            {lignes?.map((l, i) => {
                const actif = i === index;
                const depot = depotDe(l.projet.chemin);
                const etat = depot ? etatDepot(depot) : etatLisible(l.git);
                return (
                    <Box key={l.projet.chemin} height={1} overflow="hidden">
                        <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                            <Text color={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</Text>
                            <Text color={couleurProjet(l.projet.nom)}>● </Text>
                            <Text bold={actif}>{ajuste(l.projet.nom, largeurNom - 2)}</Text>
                            <Text color="gray">{ajuste(`il y a ${ilYa(l.date)}`, 15)}</Text>
                            <Text color={theme.secondaire}>{ajuste(l.git ? l.git.branche : '', 32)}</Text>
                            <Text color={etat.couleur}>{etat.texte}</Text>
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
