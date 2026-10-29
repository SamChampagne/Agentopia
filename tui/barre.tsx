import { GRAS } from './style.ts';
import { theme, fond } from '../dist/theme.js';

// Saisie commune : dans le chat d'une session, ou au bas des autres vues.

export function Barre({ valeur, cle, setValeur, soumettre, suggestions, indexSugg, choisirSugg, indication, actif, raisonPause, placeholder, maitre = false }: {
    valeur: string; cle: number; setValeur: (v: string) => void; soumettre: (v: string) => void;
    suggestions: any[]; indexSugg: number; choisirSugg: (i: number) => void;
    indication: { texte: string; couleur: string }; actif: boolean; raisonPause?: string; maitre?: boolean;
    placeholder?: string;
}) {
    return (
        <box flexShrink={0} flexDirection="column">
            {(actif ? suggestions : []).slice(0, 8).map((s, i) => (
                <box key={s.texte} height={1} flexDirection="row" paddingLeft={1} backgroundColor={i === indexSugg ? fond.selection : undefined}
                    onMouseDown={() => choisirSugg(i)}>
                    <text fg={i === indexSugg ? theme.accent : theme.secondaire} attributes={i === indexSugg ? GRAS : 0}>{`${i === indexSugg ? '❯' : ' '} ${s.label}`}</text>
                    {s.description && <text fg={fond.discret} truncate flexGrow={1}>{`  ${s.description}`}</text>}
                </box>
            ))}
            <text fg={indication.couleur} truncate paddingLeft={1}>{` ${indication.texte}`}</text>
            <box height={3} border borderStyle="rounded" borderColor={maitre ? '#a78bfa' : actif ? fond.bordure : fond.discret} flexDirection="row" paddingLeft={1}>
                <text fg={!actif ? fond.discret : maitre ? '#a78bfa' : theme.primaire}>{!actif ? '· ' : maitre ? '◈ ' : '❯ '}</text>
                {/* key : changer la valeur depuis le code (historique, suggestion) recrée le champ avec ce texte */}
                {actif ? <input key={cle} flexGrow={1} focused value={valeur} onInput={setValeur} onSubmit={(v: unknown) => { if (typeof v === 'string') soumettre(v); }}
                    placeholder={placeholder ?? 'Message à la session ouverte · /session pour en créer une · / pour les commandes'} />
                    : <text fg={fond.discret} flexGrow={1} truncate>{raisonPause || (valeur ? `Brouillon conservé : ${valeur}` : 'Barre en pause : le clavier est utilisé dans la vue au-dessus.')}</text>}
            </box>
        </box>
    );
}
