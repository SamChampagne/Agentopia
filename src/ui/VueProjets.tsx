import { citerArgument } from '../ligneCommande.js';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue, Separateur, Titre } from './Vues.js';
import { useSynchro } from './VueGit.js';
import { bus } from './bus.js';
import { ilYa } from './Panneau.js';
import { useProjets } from './projets.js';
import { Projet, correspond } from '../projets.js';
import { activiteAgents, derniereSessionProjet } from '../activiteAgents.js';
import { Depot } from '../git.js';
import { depotDe } from '../synchro.js';
import { theme, couleurProjet, fond } from '../theme.js';

type Ligne = { type: 'groupe'; texte: string; nb: number } | { type: 'projet'; p: Projet };

const ajuste = (s: string, n: number) => (s.length > n - 1 ? s.slice(0, n - 2) + '… ' : s.padEnd(n));

// État git en mots plutôt qu'en symboles
export function etatLisible(d?: Pick<Depot, 'retard' | 'avance' | 'modifs' | 'remote' | 'amont'>): { texte: string; couleur: string } {
    if (!d) return { texte: 'pas un dépôt git', couleur: fond.eteint };
    const morceaux = [
        d.retard ? `${d.retard} à tirer` : '',
        d.avance ? `${d.avance} à pousser` : '',
        d.modifs ? `${d.modifs} modifié${d.modifs > 1 ? 's' : ''}` : '',
    ].filter(Boolean);
    if (morceaux.length) return { texte: morceaux.join(' · '), couleur: d.retard ? '#f87171' : '#facc15' };
    if (!d.remote) return { texte: 'local seulement', couleur: fond.eteint };
    if (!d.amont) return { texte: 'branche non suivie', couleur: fond.eteint };
    return { texte: 'à jour', couleur: '#4ade80' };
}

export function VueProjets({ fermer, filtreInitial = '' }: { fermer: () => void; filtreInitial?: string }) {
    const { largeur, hauteur } = useTailleVue();
    useSynchro();   // se redessine à chaque changement git
    const [filtre, setFiltre] = useState(filtreInitial);
    const [choix, setChoix] = useState<string>();
    const [debut, setDebut] = useState(0);

    const projets = useProjets().filter((p) => !filtre || correspond(p.nom, filtre));
    const activite = activiteAgents();
    const parRacine = new Map<string, Projet[]>();
    projets.forEach((p) => parRacine.set(p.racine, [...(parRacine.get(p.racine) ?? []), p]));
    const lignes: Ligne[] = [...parRacine].flatMap(([racine, ps]): Ligne[] => [
        { type: 'groupe', texte: racine === '(extra)' ? 'Autres projets' : racine, nb: ps.length },
        ...ps.map((p): Ligne => ({ type: 'projet', p })),
    ]);
    const projetsListe = lignes.filter((l): l is Extract<Ligne, { type: 'projet' }> => l.type === 'projet');
    const courant = projetsListe.find((l) => l.p.chemin === choix) ?? projetsListe[0];
    const index = lignes.indexOf(courant);
    const zone = hauteur - 4;
    let premier = Math.max(0, Math.min(debut, lignes.length - zone));
    if (index >= 0 && index < premier) premier = index;
    if (index >= premier + zone) premier = index - zone + 1;
    const visibles = lignes.slice(premier, premier + zone);

    const ouvrir = (p?: Projet) => {
        if (!p) return;
        fermer();
        bus.emit('lancer', `/actions ${citerArgument(p.chemin)}`);
    };
    const deplacer = (pas: number) => {
        const i = projetsListe.indexOf(courant);
        const l = projetsListe[Math.max(0, Math.min(projetsListe.length - 1, i + pas))];
        if (l) setChoix(l.p.chemin);
        setDebut(premier);
    };

    useClicsVue((_, y) => {
        const l = visibles[y - 3];
        if (l?.type === 'projet') ouvrir(l.p);
    }, (sens) => deplacer(-sens));

    useInput((input, key) => {
        if (key.escape) return filtre ? setFiltre('') : fermer();
        if (key.upArrow) return deplacer(-1);
        if (key.downArrow) return deplacer(1);
        if (key.return) return ouvrir(courant?.p);
        if (key.backspace || key.delete) return setFiltre((f) => f.slice(0, -1));
        // Les lettres tapées filtrent la liste
        if (input && !key.ctrl && !key.meta && /^[\p{L}\p{N}._ -]$/u.test(input)) setFiltre((f) => f + input);
    });

    const colNom = Math.min(30, Math.max(18, Math.floor(largeur * 0.24)));
    const colBranche = Math.min(30, Math.max(16, Math.floor(largeur * 0.24)));

    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="PROJETS" droite={filtre ? `filtre : « ${filtre} » · ${projets.length} projet(s) · Échap efface` : `${projets.length} projets · tape pour filtrer · clic = actions`} />
            <Box height={1} flexShrink={0}>
                <Text color="gray">{'   ' + ajuste('Projet', colNom) + ajuste('Branche', colBranche) + ajuste('État git', 26) + ajuste('Agents', 14) + 'Hébergé sur'}</Text>
            </Box>
            <Separateur largeur={largeur - 2} />
            {visibles.map((l, i) => {
                if (l.type === 'groupe') {
                    return (
                        <Box key={`g${i}`} height={1}>
                            <Text bold color={theme.primaire}>{` ${l.texte}`}</Text>
                            <Text color="gray">{`  ${l.nb}`}</Text>
                        </Box>
                    );
                }
                const actif = l === courant;
                const d = depotDe(l.p.chemin);
                const etat = etatLisible(d);
                const session = derniereSessionProjet(l.p.chemin, activite);
                return (
                    <Box key={l.p.chemin} height={1} overflow="hidden">
                        <Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>
                            <Text color={actif ? theme.accent : 'gray'}>{actif ? ' ❯ ' : '   '}</Text>
                            <Text color={couleurProjet(l.p.nom)}>● </Text>
                            <Text bold={actif}>{ajuste(l.p.nom, colNom - 2)}</Text>
                            <Text color={theme.secondaire}>{ajuste(d?.branche ?? '', colBranche)}</Text>
                            <Text color={etat.couleur}>{ajuste(etat.texte, 26)}</Text>
                            <Text color="gray">{ajuste(session ? `il y a ${ilYa(session)}` : '—', 14)}</Text>
                            <Text color="gray">{d?.hebergeur ?? ''}</Text>
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
