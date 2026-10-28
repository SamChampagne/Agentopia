import { useState } from 'react';
import { Ansi } from '../ansi.tsx';
import { GRAS } from '../style.ts';
import { theme, fond, degrade } from '../../dist/theme.js';

// Rangée de boutons d'une vue ; un bouton inactif est grisé et ne réagit pas
export function Boutons({ boutons, actifs, agir }: { boutons: { label: string; action: string }[]; actifs?: Set<string>; agir: (action: string) => void }) {
    const [survol, setSurvol] = useState<string>();
    return (
        <box height={1} flexShrink={0} flexDirection="row">
            {boutons.map((b) => {
                const actif = !actifs || actifs.has(b.action);
                const sur = actif && survol === b.action;
                return (
                    <box key={b.action} marginRight={1} backgroundColor={sur ? fond.panneauActif : fond.selection}
                        onMouseOver={() => setSurvol(b.action)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => actif && agir(b.action)}>
                        <text fg={!actif ? fond.eteint : b.action === 'fermer' ? fond.texte : theme.secondaire} attributes={sur ? GRAS : 0}>{` ${b.label} `}</text>
                    </box>
                );
            })}
        </box>
    );
}

// En-tête d'une vue : titre à gauche, aide à droite, filet en dégradé dessous (comme Titre + Separateur côté Ink)
export function Titre({ texte, droite = '' }: { texte: string; droite?: string }) {
    return (
        <box flexShrink={0} flexDirection="column">
            <box height={1} flexDirection="row">
                <text fg={theme.primaire} attributes={GRAS} flexGrow={1}>{texte}</text>
                <text fg={fond.discret}>{`${droite} `}</text>
            </box>
            <Ansi texte={degrade('─'.repeat(300))} />
        </box>
    );
}
