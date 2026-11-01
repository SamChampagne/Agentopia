import { useEffect, useRef, useState } from 'react';
import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { GRAS } from '../style.ts';
import { theme, fond } from '../../dist/theme.js';
import { creerUseConfig } from '../../dist/ui/useConfig.js';
import { Titre } from './commun.tsx';
const useConfig = creerUseConfig({ useEffect, useRef, useState });

export function VueConfig({ fermer }: { fermer: () => void }) {
    const vue = useConfig(fermer), cadre = useRef<BoxRenderable>(null), defilement = useRef<ScrollBoxRenderable>(null);
    const [largeur, setLargeur] = useState(40), [survol, setSurvol] = useState<number>();
    useEffect(() => { defilement.current?.scrollChildIntoView(`config-${vue.courant}`); }, [vue.courant, vue.recherche, largeur]);
    useKeyboard(k => vue.clavier(k.ctrl ? k.name : k.sequence || '', k.name, k.ctrl, k.meta));
    const colLabel = Math.min(26, Math.max(12, Math.floor(largeur * .35)));
    const selection = vue.selection?.type === 'reglage' ? vue.selection : undefined;
    return (
        <box ref={cadre} onSizeChange={() => setLargeur(cadre.current?.width || 40)} flexGrow={1} flexDirection="column" paddingLeft={1}>
            <Titre texte="CONFIGURATION" droite="/ rechercher" />
            <text height={1} truncate fg={vue.edition ? theme.accent : fond.discret}>{vue.edition || vue.recherche ? `⌕ ${vue.recherche} · Échap effacer` : '/ pour rechercher · ↑↓ choisir · Entrée ouvrir'}</text>
            <scrollbox ref={defilement} verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {!vue.lignes.length && <text fg={fond.discret}>Aucun réglage trouvé · Échap effacer</text>}
                {vue.lignes.map((l, i) => {
                    if (l.type === 'section') return <text key={i} fg={theme.primaire} attributes={GRAS}>{` ${l.texte}`}</text>;
                    const actif = i === vue.courant || i === survol;
                    return <box key={i} id={`config-${i}`} height={1} flexDirection="row" backgroundColor={i === vue.courant ? fond.selection : undefined}
                        onMouseOver={() => setSurvol(i)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => vue.activer(i)}>
                        <text width={3} flexShrink={0} fg={actif ? theme.accent : 'gray'}>{i === vue.courant ? ' ❯ ' : '   '}</text>
                        <text width={colLabel} flexShrink={0} fg={fond.texte} truncate>{l.label}</text>
                        <text flexGrow={1} flexShrink={1} fg={l.couleur ?? theme.secondaire} truncate>{l.valeur}</text>
                        {largeur >= 105 && <text width={25} truncate fg={actif ? theme.accent : fond.discret}>{` ${l.aide} › `}</text>}
                    </box>;
                })}
            </scrollbox>
            <box height={5} flexShrink={0} flexDirection="column" border={["top"]} borderColor={fond.bordure}>
                <text height={1} truncate attributes={GRAS} fg={theme.accent}>{selection?.label || 'Recherche des réglages'}</text>
                <text height={2} wrapMode="word" fg={selection?.couleur ?? theme.secondaire}>{selection?.valeur || 'Change les mots recherchés pour retrouver un réglage.'}</text>
                <text height={1} truncate fg={fond.discret}>{selection ? `${selection.aide} · Entrée ouvrir · Échap retour` : 'Échap effacer la recherche'}</text>
            </box>
        </box>
    );
}
