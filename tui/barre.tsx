import { GRAS } from './style.ts';
import { theme, fond } from '../dist/theme.js';

// Barre du bas : suggestions au-dessus (commandes, projets, @prompts), la ligne qui dit où part le texte, puis la saisie.

export function Barre({ valeur, cle, setValeur, soumettre, suggestions, indexSugg, choisirSugg, indication, actif, maitre = false }: {
    valeur: string; cle: number; setValeur: (v: string) => void; soumettre: (v: string) => void;
    suggestions: any[]; indexSugg: number; choisirSugg: (i: number) => void;
    indication: { texte: string; couleur: string }; actif: boolean; maitre?: boolean;
}) {
    return (
        <box flexShrink={0} flexDirection="column">
            {suggestions.slice(0, 8).map((s, i) => (
                <box key={s.texte} height={1} flexDirection="row" paddingLeft={1} backgroundColor={i === indexSugg ? fond.selection : undefined}
                    onMouseDown={() => choisirSugg(i)}>
                    <text fg={i === indexSugg ? theme.accent : theme.secondaire} attributes={i === indexSugg ? GRAS : 0}>{`${i === indexSugg ? '❯' : ' '} ${s.label}`}</text>
                    {s.description && <text fg={fond.discret} truncate flexGrow={1}>{`  ${s.description}`}</text>}
                </box>
            ))}
            <text fg={indication.couleur} truncate paddingLeft={1}>{` ${indication.texte}`}</text>
            <box height={3} border borderStyle="rounded" borderColor={maitre ? '#a78bfa' : actif ? fond.bordure : fond.discret} flexDirection="row" paddingLeft={1}>
                <text fg={maitre ? '#a78bfa' : theme.primaire}>{maitre ? '◈ ' : '❯ '}</text>
                {/* key : changer la valeur depuis le code (historique, suggestion) recrée le champ avec ce texte */}
                <input key={cle} flexGrow={1} focused={actif} value={valeur} onInput={setValeur} onSubmit={soumettre}
                    placeholder="Tape / pour les commandes, une question pour Claude, ou Entrée pour le menu" />
            </box>
        </box>
    );
}
