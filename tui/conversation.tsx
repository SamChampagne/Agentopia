import { useEffect, useMemo, useState } from 'react';
import { Ansi } from './ansi.tsx';
import { GRAS } from './style.ts';
import { lireTranscript } from '../dist/agents.js';
import { lignesTranscript } from '../dist/ui/Zones.js';
import { actionsSession } from '../dist/ui/saisie.js';
import { dollars } from '../dist/cout.js';
import { theme, fond, couleurProjet } from '../dist/theme.js';

// Conversation d'une session : ses actions à gauche (la description de celle survolée en dessous),
// le texte à droite. Défilement natif à la molette, collé en bas : la fin suit en direct ; texte sélectionnable.

const COL = 24;

export function Conversation({ s, largeur, cout, agir }: { s: any; largeur: number; cout?: number; agir: (action: string) => void }) {
    // lireTranscript relit seulement la fin ajoutée et rend le même tableau si rien n'a changé (pas de rendu inutile)
    const [messages, setMessages] = useState<any[]>(() => lireTranscript(s.fichier));
    useEffect(() => {
        const lire = () => setMessages(lireTranscript(s.fichier));
        lire();
        const t = setInterval(lire, 1000);
        return () => clearInterval(t);
    }, [s.fichier]);
    const lignes = useMemo(() => lignesTranscript(messages, largeur - COL - 3), [messages, largeur]);
    const [survol, setSurvol] = useState<string>();
    const actions = actionsSession(s);
    const aide = actions.find((a: any) => a.action === survol)?.aide;
    return (
        <box flexGrow={1} flexDirection="column">
            <box height={1} flexDirection="row" paddingLeft={1}>
                <text flexGrow={1} truncate>
                    <span fg={couleurProjet(s.nom)}>● </span>
                    <span fg={fond.texte} attributes={GRAS}>{s.nom}</span>
                    <span fg="gray">{`  ${s.titre || s.id || ''}`}</span>
                </text>
                {cout !== undefined && <text fg={fond.discret}>{`${dollars(cout)} `}</text>}
            </box>
            <box flexGrow={1} flexDirection="row">
                <box width={COL} flexShrink={0} flexDirection="column" paddingLeft={1} paddingTop={1}>
                    {actions.map((a: any) => {
                        const sur = survol === a.action;
                        const fg = a.action === 'fermer-session' ? '#f87171' : sur ? theme.accent : a.action === 'fermer' ? fond.eteint : fond.texte;
                        return (
                            <box key={a.action} height={1} backgroundColor={sur ? fond.selection : undefined}
                                onMouseOver={() => setSurvol(a.action)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => agir(a.action)}>
                                <text fg={fg} attributes={sur ? GRAS : 0} truncate>{` ${a.label}`}</text>
                            </box>
                        );
                    })}
                    <text> </text>
                    {aide && <text fg={fond.discret} wrapMode="word">{aide}</text>}
                </box>
                <scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom" paddingRight={1}>
                    {lignes.map((l, i) => <Ansi key={i} texte={l} replier selectionnable />)}
                </scrollbox>
            </box>
        </box>
    );
}
