import { citerArgument } from '../../dist/ligneCommande.js';
import { useState } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useSelectionVisible } from '../listeClavier.ts';
import { GRAS, couper } from '../style.ts';
import { Titre } from './commun.tsx';
import { useSynchro } from './git.tsx';
import { bus } from '../../dist/ui/bus.js';
import { ilYa } from '../../dist/ui/Panneau.js';
import { etatLisible } from '../../dist/ui/VueProjets.js';
import { useProjets } from '../projets.ts';
import { correspond } from '../../dist/projets.js';
import { activiteAgents, derniereSessionProjet } from '../../dist/activiteAgents.js';
import { depotDe } from '../../dist/synchro.js';
import { theme, couleurProjet, fond } from '../../dist/theme.js';

// Projets : groupés par dossier racine ; les lettres tapées filtrent ; clic ou Entrée = actions du projet
const colonne = (s: string, n: number) => couper(s, n - 1).padEnd(n);

export function VueProjets({ fermer, filtreInitial = '' }: { fermer: () => void; filtreInitial?: string }) {
    const { width, height } = useTerminalDimensions();
    const compact = width < 110;
    useSynchro();   // se redessine à chaque changement git
    const [filtre, setFiltre] = useState(filtreInitial);
    const [choix, setChoix] = useState<string>();
    const [survol, setSurvol] = useState<string>();
    const projets = useProjets().filter((p: any) => !filtre || correspond(p.nom, filtre));
    const activite = activiteAgents();
    const parRacine = new Map<string, any[]>();
    projets.forEach((p: any) => parRacine.set(p.racine, [...(parRacine.get(p.racine) ?? []), p]));
    const liste = [...parRacine.values()].flat();
    const courant = liste.find((p) => p.chemin === choix) ?? liste[0];
    const defilement = useSelectionVisible(courant ? `projet-${liste.indexOf(courant)}` : undefined);

    const ouvrir = (p?: any) => {
        if (!p) return;
        fermer();
        bus.emit('lancer', `/actions ${citerArgument(p.chemin)}`);
    };
    const deplacer = (pas: number) => {
        const i = liste.indexOf(courant);
        const p = liste[Math.max(0, Math.min(liste.length - 1, i + pas))];
        if (p) setChoix(p.chemin);
    };
    useKeyboard((k) => {
        if (k.name === 'escape') return filtre ? setFiltre('') : fermer();
        if (k.name === 'up') return deplacer(-1);
        if (k.name === 'down') return deplacer(1);
        if (k.name === 'pageup') return deplacer(-Math.max(1, Math.floor((height - 7) / (compact ? 2 : 1))));
        if (k.name === 'pagedown') return deplacer(Math.max(1, Math.floor((height - 7) / (compact ? 2 : 1))));
        if (k.name === 'return') return ouvrir(courant);
        if (k.name === 'backspace') return setFiltre((f) => f.slice(0, -1));
        // Les lettres tapées filtrent la liste
        if (!k.ctrl && !k.meta && k.sequence && /^[\p{L}\p{N}._ -]$/u.test(k.sequence)) setFiltre((f) => f + k.sequence);
    });

    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="PROJETS" droite={filtre ? `filtre : « ${filtre} » · ${projets.length} projet(s) · Échap efface` : `${projets.length} projets · tape pour filtrer · clic = actions`} />
            <text fg="gray">{compact ? ' Projet · état Git / branche / activité · ↑ ↓ Pg↑ Pg↓' : '   ' + colonne('Projet', 28) + colonne('Branche', 28) + colonne('État git', 26) + colonne('Agents', 14) + 'Hébergé sur'}</text>
            <scrollbox ref={defilement} verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {[...parRacine].map(([racine, ps]) => (
                    <box key={racine} flexDirection="column" flexShrink={0}>
                        <text><span fg={theme.primaire} attributes={GRAS}>{` ${racine === '(extra)' ? 'Autres projets' : racine}`}</span><span fg="gray">{`  ${ps.length}`}</span></text>
                        {ps.map((p: any) => {
                            const actif = p === courant;
                            const d = depotDe(p.chemin);
                            const etat = etatLisible(d);
                            const session = derniereSessionProjet(p.chemin, activite);
                            return (
                                <box key={p.chemin} id={`projet-${liste.indexOf(p)}`} height={compact ? 2 : 1} flexDirection="column" backgroundColor={actif ? fond.selection : survol === p.chemin ? fond.panneau : undefined}
                                    onMouseOver={() => setSurvol(p.chemin)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => ouvrir(p)}>
                                    <text truncate>
                                        <span fg={actif ? theme.accent : 'gray'}>{actif ? ' ❯ ' : '   '}</span>
                                        <span fg={couleurProjet(p.nom)}>● </span>
                                        <span attributes={actif ? GRAS : 0}>{compact ? p.nom : colonne(p.nom, 26)}</span>
                                        {!compact && <>
                                        <span fg={theme.secondaire}>{colonne(d?.branche ?? '', 28)}</span>
                                        <span fg={etat.couleur}>{colonne(etat.texte, 26)}</span>
                                        <span fg="gray">{colonne(session ? `il y a ${ilYa(session)}` : '—', 14)}</span>
                                        <span fg="gray">{d?.hebergeur ?? ''}</span>
                                        </>}
                                    </text>
                                    {compact && <text truncate fg={etat.couleur}>{`     ${etat.texte} · ${d?.branche || 'sans branche'}${session ? ` · agent ${ilYa(session)}` : ''}`}</text>}
                                </box>
                            );
                        })}
                    </box>
                ))}
                {!liste.length && <text fg="gray">  aucun projet ne correspond</text>}
            </scrollbox>
        </box>
    );
}
