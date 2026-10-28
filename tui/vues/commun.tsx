import { Ansi } from '../ansi.tsx';
import { GRAS } from '../style.ts';
import { theme, fond, degrade } from '../../dist/theme.js';

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
