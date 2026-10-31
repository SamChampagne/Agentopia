import { useEffect, useRef, useState } from 'react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { GRAS, couper } from '../style.ts';
import { bus } from '../../dist/ui/bus.js';
import { compteClaude } from '../../dist/configCommandes.js';
import { lireEtatConfig, lignesConfig } from '../../dist/ui/VueConfig.js';
import { theme, fond } from '../../dist/theme.js';
import { Titre } from './commun.tsx';
import { etatCompteGitHub, type EtatCompteGitHub } from '../../dist/compteGitHub.js';

// Configuration : les mêmes réglages que l'interface Ink ; clic ou Entrée lance la commande du réglage,
// puis la vue se rouvre (pour enchaîner les réglages)
export function VueConfig({ fermer }: { fermer: () => void }) {
    const [claude, setClaude] = useState<any>();
    const [github, setGitHub] = useState<EtatCompteGitHub>();
    useEffect(() => { let actif = true; void etatCompteGitHub().then(v => { if (actif) setGitHub(v); }); return () => { actif = false; }; }, []);
    useEffect(() => void compteClaude().then(setClaude), []);
    const [etat] = useState(lireEtatConfig);
    const lignes = lignesConfig(etat, claude, github);
    const reglages = lignes.map((l: any, i: number) => (l.type === 'reglage' ? i : -1)).filter((i: number) => i >= 0);
    const [index, setIndex] = useState(reglages[0]);
    const defilement = useRef<ScrollBoxRenderable>(null);
    useEffect(() => { defilement.current?.scrollChildIntoView(`config-${index}`); }, [index]);
    const [survol, setSurvol] = useState<number>();
    const activer = (i: number) => {
        const l = lignes[i];
        if (l?.type !== 'reglage') return;
        fermer();
        bus.emit('lancer', [l.commande, '/config']);
    };
    useKeyboard((k) => {
        const p = reglages.indexOf(index);
        if (k.name === 'escape' || k.sequence === 'q') return fermer();
        if (k.name === 'up') setIndex(reglages[Math.max(0, p - 1)]);
        if (k.name === 'down') setIndex(reglages[Math.min(reglages.length - 1, p + 1)]);
        if (k.name === 'return') activer(index);
    });
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="CONFIGURATION" droite="clic ou Entrée = modifier · Échap fermer" />
            <scrollbox ref={defilement} verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {lignes.map((l: any, i: number) => {
                    if (l.type === 'section') return <text key={i} fg={theme.primaire} attributes={GRAS}>{` ${l.texte}`}</text>;
                    const actif = i === index || i === survol;
                    return (
                        <box key={i} id={`config-${i}`} height={1} flexDirection="row" backgroundColor={i === index ? fond.selection : undefined}
                            onMouseOver={() => setSurvol(i)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => activer(i)}>
                            <text fg={actif ? theme.accent : 'gray'}>{i === index ? ' ❯ ' : '   '}</text>
                            <text width={26} fg={fond.texte} truncate>{couper(l.label, 25)}</text>
                            <text flexGrow={1} fg={l.couleur ?? theme.secondaire} truncate>{l.valeur}</text>
                            <text fg={actif ? theme.accent : fond.discret}>{` ${l.aide} › `}</text>
                        </box>
                    );
                })}
            </scrollbox>
        </box>
    );
}
