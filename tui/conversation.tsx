import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useKeyboard } from '@opentui/react';
import { Ansi } from './ansi.tsx';
import { GRAS } from './style.ts';
import { lireTranscript } from '../dist/agents.js';
import { lignesTranscript } from '../dist/ui/Zones.js';
import { actionsSession } from '../dist/ui/saisie.js';
import { dollars } from '../dist/cout.js';
import { theme, fond, couleurProjet } from '../dist/theme.js';
import { Boutons } from './vues/commun.tsx';
import { DiffDirect } from './diffDirect.tsx';
import { presenterPermission } from '../dist/presentationPermission.js';

// Conversation d'une session : ses actions à gauche (la description de celle survolée en dessous),
// le texte à droite. Défilement natif à la molette, collé en bas : la fin suit en direct ; texte sélectionnable.

const COL = 24;

// position (/ecran) : actions en colonne à gauche ou à droite, en rangée en haut, ou cachées (clic droit)
// recherche (Ctrl+F) : les lignes qui contiennent le terme sont surlignées ; occurrence = laquelle montrer (la plus récente d'abord)
export function Conversation({ s, largeur, cout, agir, position = 'gauche', recherche = '', occurrence = 0, surTrouvees, diff = true, saisie }: {
    s: any; largeur: number; cout?: number; agir: (action: string) => void; position?: string;
    recherche?: string; occurrence?: number; surTrouvees?: (n: number) => void; diff?: boolean;
    saisie?: ReactNode;
}) {
    // lireTranscript relit seulement la fin ajoutée et rend le même tableau si rien n'a changé (pas de rendu inutile)
    const [messages, setMessages] = useState<any[]>(() => lireTranscript(s.fichier));
    useEffect(() => {
        const lire = () => setMessages(lireTranscript(s.fichier));
        lire();
        const t = setInterval(lire, 200);
        return () => clearInterval(t);
    }, [s.fichier]);
    const enColonne = position === 'gauche' || position === 'droite';
    const [details, setDetails] = useState(false);
    useKeyboard((k) => { if ((k.meta || k.option) && k.name === 'l') setDetails((v) => !v); });
    const lignes = useMemo(() => lignesTranscript(messages, largeur - (enColonne ? COL : 0) - 4, details), [messages, largeur, enColonne, details]);
    const [survol, setSurvol] = useState<string>();
    const defilement = useRef<any>();
    const terme = recherche.length >= 2 ? recherche.toLowerCase() : '';
    const trouvees = useMemo(() => {
        if (!terme) return [];
        const indices: number[] = [];
        lignes.forEach((l, i) => l.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase().includes(terme) && indices.push(i));
        return indices.reverse();
    }, [lignes, terme]);
    const courante = trouvees.length ? trouvees[occurrence % trouvees.length] : -1;
    useEffect(() => surTrouvees?.(trouvees.length), [trouvees.length]);
    useEffect(() => {
        if (courante >= 0) defilement.current?.scrollChildIntoView?.(`ligne-${courante}`);
    }, [courante]);
    const actions = [...actionsSession(s)];
    actions.splice(1, 0, { label: details ? '≡ Résumer les outils' : '≡ Détails des outils', action: 'details-outils', aide: 'Alt+L : commandes exactes et sortie conservée, ou retour au résumé.' });
    const executerAction = (action: string) => action === 'details-outils' ? setDetails(!details) : agir(action);
    const aide = actions.find((a: any) => a.action === survol)?.aide;
    return (
        <box flexGrow={1} flexShrink={1} minWidth={0} minHeight={0} flexDirection="column">
            <box height={1} flexDirection="row" paddingLeft={1}>
                <text flexGrow={1} truncate>
                    <span fg={couleurProjet(s.nom)}>● </span>
                    <span fg={fond.texte} attributes={GRAS}>{s.nom}</span>
                    <span fg="gray">{`  ${s.fournisseur ? `${s.fournisseur} · ` : ''}${s.titre || s.id || ''}`}</span>
                </text>
                {cout !== undefined && <text fg={fond.discret}>{`${dollars(cout)} `}</text>}
            </box>
            {s.permission && <box paddingLeft={1} onMouseDown={() => agir('autorisation')}><text fg="#fb923c" wrapMode="word">{`! ${presenterPermission(s.permission).titre} · ${s.permission.commande || s.permission.titre} · clique ici pour répondre`}</text></box>}
            {s.erreur && <text fg="#facc15" wrapMode="word">{s.erreur}</text>}
            {s.integree && <text fg={fond.eteint} paddingLeft={1}>{s.terminalExterne ? 'Terminal Codex ouvert · lecture seule ici jusqu’à sa fermeture' : s.statut === 'travaille' ? '● En direct · messages et sorties des outils' : s.statut === 'bloquee' ? '● En attente de ta réponse' : 'Conversation à jour'}</text>}
            {s.integree && !messages.length && <text fg={fond.discret} paddingLeft={1}>Écris ton premier message dans la barre ci-dessous.</text>}
            {position === 'haut' && <box paddingLeft={1} border={['bottom']} borderColor={fond.bordure}><Boutons boutons={actions} agir={executerAction} /></box>}
            <box flexGrow={1} flexShrink={1} minHeight={0} flexDirection={position === 'droite' ? 'row-reverse' : 'row'}>
                {enColonne && <box width={COL} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1}
                    border={position === 'droite' ? ['left'] : ['right']} borderColor={fond.bordure}>
                    {actions.map((a: any) => {
                        const sur = survol === a.action;
                        const fg = a.action === 'fermer-session' ? '#f87171' : sur ? theme.accent : a.action === 'fermer' ? fond.eteint : fond.texte;
                        return (
                            <box key={a.action} height={1} backgroundColor={sur ? fond.selection : undefined}
                                onMouseOver={() => setSurvol(a.action)} onMouseOut={() => setSurvol(undefined)} onMouseDown={() => executerAction(a.action)}>
                                <text fg={fg} attributes={sur ? GRAS : 0} truncate>{` ${a.label}`}</text>
                            </box>
                        );
                    })}
                    <text> </text>
                    {aide && <text fg={fond.discret} wrapMode="word">{aide}</text>}
                </box>}
                <box flexGrow={1} flexShrink={1} minWidth={0} minHeight={0} flexDirection="column">
                    <scrollbox verticalScrollbarOptions={{ visible: false }} ref={defilement} flexGrow={1} flexShrink={1} minHeight={0} scrollY stickyScroll stickyStart="bottom" paddingLeft={1} paddingRight={1}>
                        {lignes.map((l, i) => (
                            <box key={i} id={`ligne-${i}`} flexShrink={0}
                                backgroundColor={i === courante ? fond.panneauActif : terme && trouvees.includes(i) ? fond.selection : undefined}>
                                <Ansi texte={l} replier selectionnable />
                            </box>
                        ))}
                    </scrollbox>
                    {/* La dernière modification de fichier, qui s'écrit en direct (Alt+D pour la cacher) */}
                    {diff && <DiffDirect s={s} largeur={largeur - (enColonne ? COL : 0)} />}
                    {saisie && <box flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}>{saisie}</box>}
                </box>
            </box>
        </box>
    );
}
