// Prototype : l'écran d'accueil de Claudetopia sous OpenTUI, au même style, avec les vraies données.
// Colonne de gauche (Sessions / Projets, cartes, maître, Docker et SSH en bas), cockpit, vue d'une session, saisie.
// Lancer : bun tui/app.tsx   (Ctrl+C pour quitter)
import { useEffect, useState } from 'react';
import { createCliRenderer, TextAttributes } from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
import { Ansi } from './ansi.tsx';
import { demarrerCollecte, lireDonnees, surMajDonnees } from '../dist/ui/donnees.js';
import { lignesCockpit, JOURNAL } from '../dist/ui/Cockpit.js';
import { lignesEspace } from '../dist/ui/espaces.js';
import { lignesDocker } from '../dist/ui/Laterale.js';
import { lireTranscript } from '../dist/agents.js';
import { listerProjets } from '../dist/projets.js';
import { chargerConfig } from '../dist/config.js';
import { demarrerSynchro } from '../dist/synchro.js';
import { theme, fond, couleurProjet, degrade } from '../dist/theme.js';

const COULEURS: Record<string, string> = { travaille: '#4ade80', attend: '#facc15', bloquee: '#fb923c', terminee: '#94a3b8' };
const LIBELLES: Record<string, string> = { travaille: 'travaille', attend: 't’attend', bloquee: 'bloquée', terminee: 'terminée' };
const ANIM = ['✻', '✼', '✽', '✾', '✿', '❀'];
const BOUTONS = ['◉ Live', '▦ Projets', '◆ Équipes', '⎇ Git', '◫ Docker', '⇄ SSH', '⋯'];
const une = (s: string) => s.replace(/\s+/g, ' ').trim();
const couper = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, Math.max(0, n - 1)).join('') + '…' : s);
const B = TextAttributes.BOLD;

function useDonnees() {
    const [, setV] = useState(0);
    useEffect(() => surMajDonnees(() => setV((v) => v + 1)), []);
    return lireDonnees();
}

// Une seule horloge : 800 ms si quelque chose s'anime, sinon 1 s (comme l'appli actuelle)
function useBattement(anime: boolean) {
    const [tic, setTic] = useState(0);
    useEffect(() => {
        const t = setTimeout(() => setTic((x) => x + 1), anime ? 800 : 1000);
        return () => clearTimeout(t);
    }, [tic, anime]);
    return tic;
}

function Carte({ s, a, active, survole, largeur, tic, choisir, survoler }: any) {
    const couleur = COULEURS[s.statut] ?? fond.discret;
    const icone = s.statut === 'travaille' ? ANIM[tic % ANIM.length] : s.statut === 'bloquee' ? '!' : s.statut === 'terminee' ? '✓' : '○';
    const etat = `${icone} ${LIBELLES[s.statut] ?? s.statut}`;
    const action = s.question ? `? ${une(s.question)}` : a?.outil ? `▸ ${une(a.outil)}` : a?.dernierTexte ? une(a.dernierTexte) : s.titre || 'pas encore d’activité';
    const bg = active ? fond.panneauActif : survole ? fond.selection : fond.panneau;
    const n = largeur - 3;
    return (
        <box height={3} flexShrink={0} onMouseDown={choisir} onMouseOver={() => survoler(true)} onMouseOut={() => survoler(false)}>
            <box height={1} backgroundColor={bg} flexDirection="row">
                <text fg={active ? theme.accent : couleur}>▌ </text>
                <text flexGrow={1} truncate><span fg={couleurProjet(s.nom)}>● </span><span fg={fond.texte} attributes={B}>{s.nom}</span></text>
                <text fg={couleur}>{etat} </text>
            </box>
            <box height={1} backgroundColor={bg} flexDirection="row">
                <text fg={active ? theme.accent : couleur}>▌ </text>
                <text fg="#94a3b8" truncate>{'  ' + couper(action, n - 2)}</text>
            </box>
        </box>
    );
}

function Entete({ titre, droite = '', clic }: { titre: string; droite?: string; clic?: () => void }) {
    return (
        <box height={1} flexShrink={0} backgroundColor={fond.entete} flexDirection="row" onMouseDown={clic}>
            <text fg={theme.primaire} attributes={B} flexGrow={1}>{` ${titre}`}</text>
            <text fg="gray">{`${droite} `}</text>
        </box>
    );
}

function Colonne({ d, largeur, selection, choisir, tic, espace, setEspace, projets }: any) {
    const [survol, setSurvol] = useState<string>();
    const [replie, setReplie] = useState<Record<string, boolean>>({ ssh: false, docker: false });
    const docker: string[] = lignesDocker(d);
    const serveurs = d.serveurs.slice(0, 6);
    return (
        <box width={largeur} flexShrink={0} flexDirection="column" border={['right']} borderColor={fond.bordure}>
            <box height={1} flexShrink={0} backgroundColor={fond.entete} flexDirection="row">
                <text> </text>
                {['sessions', 'projets'].map((e) => (
                    <text key={e} onMouseDown={() => setEspace(e)} onMouseOver={() => setSurvol(`onglet:${e}`)} onMouseOut={() => setSurvol(undefined)}
                        fg={espace === e ? theme.accent : survol === `onglet:${e}` ? fond.texte : fond.eteint}
                        attributes={espace === e ? B | TextAttributes.UNDERLINE : 0}>{e === 'sessions' ? 'Sessions' : 'Projets'}  </text>
                ))}
            </box>
            {espace === 'projets' ? (
                // Défilement natif à la molette : plus de calcul de décalage à la main
                <scrollbox flexGrow={1} scrollY>
                    {lignesEspace('projets', d, projets).map((l: any) => (
                        <box key={l.cle} height={1} flexDirection="row" backgroundColor={survol === l.cle ? fond.selection : undefined}
                            onMouseOver={() => setSurvol(l.cle)} onMouseOut={() => setSurvol(undefined)}>
                            <text flexGrow={1} truncate>{'  '}{l.morceaux.map((m: any, i: number) => <span key={i} fg={m.c} attributes={m.gras ? B : 0}>{m.t}</span>)}</text>
                            <text fg={l.couleurDroite}>{`${l.droite ?? ''} `}</text>
                        </box>
                    ))}
                </scrollbox>
            ) : (
                <box flexGrow={1} flexDirection="column">
                    <scrollbox flexGrow={1} scrollY>
                        {d.agents.map((s: any) => (
                            <Carte key={s.cle} s={s} a={d.activites.get(s.sessionId)} active={s.cle === selection} survole={survol === s.cle}
                                largeur={largeur - 1} tic={tic} choisir={() => choisir(s.cle)} survoler={(v: boolean) => setSurvol(v ? s.cle : undefined)} />
                        ))}
                    </scrollbox>
                    <text>{' '}<span fg={theme.accent}>+ Session</span>{'   '}<span fg={theme.secondaire}>❯ Terminal</span></text>
                    <text> </text>
                    <Entete titre="◇ MAÎTRE" droite="Alt+M" />
                    <text fg="gray">{' ex. « lance les tests sur dev »'}</text>
                </box>
            )}
            <text> </text>
            <Entete titre="DOCKER" droite={replie.docker ? '▸' : '▾'} clic={() => setReplie((r) => ({ ...r, docker: !r.docker }))} />
            {!replie.docker && docker.slice(0, 4).map((l, i) => <box key={i} height={1} paddingLeft={1}><Ansi texte={l} /></box>)}
            <text> </text>
            <Entete titre="SERVEURS SSH" droite={`${d.serveurs.length} ${replie.ssh ? '▸' : '▾'}`} clic={() => setReplie((r) => ({ ...r, ssh: !r.ssh }))} />
            {!replie.ssh && serveurs.map((s: any) => {
                const ok = d.joignables.get(s);
                const acces = d.acces[s.nom];
                return (
                    <box key={s.nom} height={1} paddingLeft={1} flexDirection="row" backgroundColor={survol === `ssh:${s.nom}` ? fond.selection : undefined}
                        onMouseOver={() => setSurvol(`ssh:${s.nom}`)} onMouseOut={() => setSurvol(undefined)}>
                        <text truncate>
                            <span fg={ok === undefined ? 'gray' : ok ? '#4ade80' : '#f87171'}>● </span>
                            <span>{couper(s.nom, 24).padEnd(24)}</span>
                            <span fg={acces ? (acces.ok ? '#4ade80' : '#facc15') : 'gray'}>{acces ? (acces.ok ? 'clé' : 'mdp') : ''}</span>
                        </text>
                    </box>
                );
            })}
        </box>
    );
}

// Conversation d'une session : défilement natif, collé en bas (la fin suit en direct), texte sélectionnable à la souris
function VueSession({ s }: any) {
    const [messages, setMessages] = useState<any[]>([]);
    useEffect(() => {
        const lire = () => setMessages(lireTranscript(s.fichier));
        lire();
        const t = setInterval(lire, 1000);
        return () => clearInterval(t);
    }, [s.fichier]);
    const couleur: Record<string, string> = { user: theme.accent, assistant: fond.texte, outil: theme.secondaire, resultat: '#64748b' };
    const prefixe: Record<string, string> = { user: '❯ ', assistant: '', outil: '▸ ', resultat: '  ⎿ ' };
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <text><span fg={couleurProjet(s.nom)}>● </span><span attributes={B}>{s.nom}</span><span fg="gray">{`  ${s.titre ?? ''}  · Échap pour revenir`}</span></text>
            <scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom">
                {messages.slice(-400).map((m, i) => (
                    <text key={i} selectable fg={couleur[m.role]} wrapMode="word">{prefixe[m.role] + m.texte}</text>
                ))}
            </scrollbox>
        </box>
    );
}

export function App() {
    const d = useDonnees();
    const { width, height } = useTerminalDimensions();
    const [selection, setSelection] = useState<string>();
    const [espace, setEspace] = useState('sessions');
    const [survolHaut, setSurvolHaut] = useState<string>();
    const anime = d.agents.some((a: any) => a.statut === 'travaille');
    const tic = useBattement(anime);
    const [projets] = useState(() => listerProjets(chargerConfig()));
    useEffect(() => demarrerSynchro(projets), []);
    useKeyboard((k) => {
        if (k.name === 'escape') setSelection(undefined);
    });
    const lateral = Math.max(32, Math.min(56, Math.floor(width / 3)));
    const principal = width - lateral;
    const corps = height - 5;
    const session = d.agents.find((a: any) => a.cle === selection);
    const cockpit = lignesCockpit(d, principal - 1, corps);
    return (
        <box width={width} height={height} flexDirection="column" backgroundColor="#0c0c0c">
            <box height={1} flexDirection="row">
                <Ansi texte={degrade(' ✻ ' + (chargerConfig().banniere || 'CLAUDETOPIA').toUpperCase() + ' ')} />
                {BOUTONS.map((b) => (
                    <text key={b} onMouseOver={() => setSurvolHaut(b)} onMouseOut={() => setSurvolHaut(undefined)}
                        fg={survolHaut === b ? fond.texte : fond.eteint} attributes={survolHaut === b ? B : 0}>{`  ${b} `}</text>
                ))}
            </box>
            <Ansi texte={degrade('─'.repeat(width))} />
            <box flexGrow={1} flexDirection="row">
                <Colonne d={d} largeur={lateral} selection={selection} choisir={setSelection} tic={tic} espace={espace} setEspace={setEspace} projets={projets} />
                {session ? <VueSession s={session} /> : (
                    <box flexGrow={1} flexDirection="column" paddingLeft={1}
                        onMouseDown={(e: any) => {
                            const c = cockpit.cible(e.x - lateral - 1, e.y - 2);
                            if (c && c !== JOURNAL) setSelection(c);
                        }}>
                        {cockpit.lignes.slice(0, corps).map((l: string, i: number) => <Ansi key={i} texte={l} />)}
                    </box>
                )}
            </box>
            <box height={3} border borderStyle="rounded" borderColor={fond.bordure} flexDirection="row" paddingLeft={1}>
                <text fg={theme.primaire}>❯ </text>
                <input flexGrow={1} focused placeholder="Tape / pour les commandes, une question pour Claude, ou Entrée pour le menu" />
            </box>
        </box>
    );
}

if (import.meta.main) {
    demarrerCollecte();
    const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true, enableMouseMovement: true });
    createRoot(renderer).render(<App />);
}
