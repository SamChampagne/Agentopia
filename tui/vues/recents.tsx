import { citerArgument } from '../../dist/ligneCommande.js';
import { useEffect, useMemo, useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useSelectionVisible } from '../listeClavier.ts';
import { GRAS, couper } from '../style.ts';
import { Titre } from './commun.tsx';
import { useSynchro } from './git.tsx';
import { bus } from '../../dist/ui/bus.js';
import { ilYa } from '../../dist/ui/Panneau.js';
import { etatLisible } from '../../dist/ui/VueProjets.js';
import { useProjets } from '../projets.ts';
import { projetsRecents } from '../../dist/dashboard.js';
import { etatGitAsync } from '../../dist/projets.js';
import { depotDe } from '../../dist/synchro.js';
import { theme, couleurProjet, fond } from '../../dist/theme.js';

// Projets récents : les plus actifs d'abord ; clic ou Entrée = actions du projet.
// L'état git vient de la synchro (déjà en mémoire) ; git status en fond seulement pour un projet qu'elle ne suit pas.
const colonne = (s: string, n: number) => couper(s, n - 1).padEnd(n);

export function VueRecents({ fermer }: { fermer: () => void }) {
    useSynchro();
    const projets = useProjets();
    const lignes = useMemo(() => projetsRecents(projets, 40), [projets]);
    const { width, height } = useTerminalDimensions();
    const compact = width < 110;
    const [horsSynchro, setHorsSynchro] = useState<Record<string, any>>({});
    const [index, setIndex] = useState(0);
    const courant = Math.max(0, Math.min(index, lignes.length - 1));
    const defilement = useSelectionVisible(`recent-${courant}`);
    const [survol, setSurvol] = useState<number>();
    useEffect(() => {
        let actif = true;
        for (const { projet } of lignes) {
            if (depotDe(projet.chemin)) continue;
            etatGitAsync(projet.chemin).then((g: any) => actif && setHorsSynchro((x) => ({ ...x, [projet.chemin]: g ?? null })));
        }
        return () => void (actif = false);
    }, [lignes]);
    const ouvrir = (i: number) => {
        const l = lignes[i];
        if (!l) return;
        fermer();
        bus.emit('lancer', `/actions ${citerArgument(l.projet.chemin)}`);
    };
    useKeyboard((k) => {
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        if (k.name === 'up') setIndex((i) => Math.max(0, i - 1));
        if (k.name === 'down') setIndex((i) => Math.min(lignes.length - 1, i + 1));
        if (k.name === 'pageup') setIndex(i => Math.max(0, i - Math.max(1, Math.floor((height - 4) / (compact ? 2 : 1)))));
        if (k.name === 'pagedown') setIndex(i => Math.min(lignes.length - 1, i + Math.max(1, Math.floor((height - 4) / (compact ? 2 : 1)))));
        if (k.name === 'return') ouvrir(courant);
    });
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="PROJETS RÉCENTS" droite="clic = actions du projet · Échap fermer" />
            <text fg="gray">{compact ? ' Projet · activité / branche / état · ↑ ↓ Pg↑ Pg↓' : '  ' + colonne('Projet', 28) + colonne('Activité', 15) + colonne('Branche', 32) + 'État'}</text>
            <scrollbox ref={defilement} verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {lignes.map((l: any, i: number) => {
                    const actif = i === courant;
                    const depot = depotDe(l.projet.chemin);
                    const g = horsSynchro[l.projet.chemin];
                    const etat = depot ? etatLisible(depot)
                        : g === undefined ? { texte: 'lecture…', couleur: fond.eteint }
                            : !g ? { texte: 'pas un dépôt git', couleur: fond.eteint }
                                : etatLisible({ retard: g.enRetard, avance: g.enAvance, modifs: g.modifs, remote: 'oui', amont: 'oui' });
                    return (
                        <box key={l.projet.chemin} id={`recent-${i}`} height={compact ? 2 : 1} flexDirection="column" backgroundColor={actif ? fond.selection : survol === i ? fond.panneau : undefined}
                            onMouseOver={() => setSurvol(i)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => ouvrir(i)}>
                            <text truncate>
                                <span fg={actif ? theme.accent : 'gray'}>{actif ? '❯ ' : '  '}</span>
                                <span fg={couleurProjet(l.projet.nom)}>● </span>
                                <span attributes={actif ? GRAS : 0}>{compact ? l.projet.nom : colonne(l.projet.nom, 26)}</span>
                                {!compact && <>
                                <span fg="gray">{colonne(`il y a ${ilYa(l.date)}`, 15)}</span>
                                <span fg={theme.secondaire}>{colonne(depot?.branche ?? g?.branche ?? '', 32)}</span>
                                <span fg={etat.couleur}>{etat.texte}</span>
                                </>}
                            </text>
                            {compact && <text truncate fg={etat.couleur}>{`    ${etat.texte} · ${depot?.branche ?? g?.branche ?? 'sans branche'} · il y a ${ilYa(l.date)}`}</text>}
                        </box>
                    );
                })}
            </scrollbox>
        </box>
    );
}
