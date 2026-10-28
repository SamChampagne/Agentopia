import { useEffect, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { GRAS } from '../style.ts';
import { bus } from '../../dist/ui/bus.js';
import { lignes, apercu } from '../../dist/ui/VueEcran.js';
import { disposition, changerDisposition } from '../../dist/ui/disposition.js';
import { theme, fond } from '../../dist/theme.js';

// Disposition de l'écran : chaque réglage s'applique tout de suite (l'écran derrière change en direct),
// l'aperçu à droite montre où va chaque chose. Mêmes réglages que l'interface Ink.
export function VueEcran({ fermer, config }: { fermer: () => void; config: any }) {
    useEffect(() => {
        bus.emit('plein-ecran', true);
        return () => void bus.emit('plein-ecran', false);
    }, []);
    const toutes = lignes();
    const reglages = toutes.map((l: any, i: number) => ('section' in l ? -1 : i)).filter((i: number) => i >= 0);
    const [choix, setChoix] = useState(reglages[0]);
    const [, setV] = useState(0);
    const d = disposition();
    const changer = (i: number, sens: number) => {
        const r = toutes[i];
        const n = r.valeurs.length;
        changerDisposition(r.valeurs[(r.actuelle(d) + sens + n) % n].appliquer(), config);
        setV((v) => v + 1);
    };
    useKeyboard((k) => {
        const pos = reglages.indexOf(choix);
        if (k.name === 'up') setChoix(reglages[(pos - 1 + reglages.length) % reglages.length]);
        if (k.name === 'down' || k.name === 'tab') setChoix(reglages[(pos + 1) % reglages.length]);
        if (k.name === 'right' || k.name === 'return' || k.name === 'space') changer(choix, 1);
        if (k.name === 'left') changer(choix, -1);
        if (k.name === 'escape' || k.sequence === 'q') fermer();
    });
    const r = toutes[choix];
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <text fg={theme.primaire} attributes={GRAS}>DISPOSITION DE L'ÉCRAN</text>
            <text fg="gray" truncate>↑↓ choisir · ←→, Entrée ou clic pour changer · s’applique tout de suite · Échap pour fermer</text>
            <text> </text>
            <box flexGrow={1} flexDirection="row">
                <box width={64} flexShrink={0} flexDirection="column">
                    {toutes.map((l: any, i: number) => {
                        if ('section' in l) return <text key={i} fg={theme.secondaire} attributes={GRAS}>{l.section}</text>;
                        const actif = i === choix;
                        const v = l.actuelle(d);
                        return (
                            <box key={i} height={1} flexDirection="row" backgroundColor={actif ? fond.selection : undefined}
                                onMouseDown={() => {
                                    setChoix(i);
                                    changer(i, 1);
                                }}>
                                <text fg={actif ? theme.accent : fond.texte} attributes={actif ? GRAS : 0}>{`${actif ? '›' : ' '} ${l.label}`.padEnd(30)}</text>
                                {l.valeurs.map((val: any, k: number) => (
                                    <text key={k} fg={k === v ? fond.panneau : fond.eteint} bg={k === v ? theme.accent : undefined} attributes={k === v ? GRAS : 0}>{` ${val.nom} `}</text>
                                ))}
                            </box>
                        );
                    })}
                    <text> </text>
                    <text fg="gray" wrapMode="word">{r?.aide}</text>
                </box>
                <box flexDirection="column" marginLeft={2} border borderStyle="rounded" borderColor={fond.bordure} paddingLeft={1} paddingRight={1}>
                    <text fg={theme.primaire} attributes={GRAS}>APERÇU</text>
                    {apercu(d).map((l: string, i: number) => <text key={i} fg={i === 0 ? theme.secondaire : fond.texte} truncate>{l || ' '}</text>)}
                </box>
            </box>
        </box>
    );
}
