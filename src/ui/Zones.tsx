import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { chargerConfig } from '../config.js';
import { useMemo } from 'react';
import { useAppui } from './appui.js';
import { dollars } from '../cout.js';
import { Box, Text } from 'ink';
import { Message } from '../agents.js';
import { SessionVue } from '../agents.js';
import { EtatGit } from '../projets.js';
import { Bouton, nbRangees, COL_ACTIONS, ActionSession } from './mise.js';
import { theme, couleurProjet, c, fond, degrade } from '../theme.js';
import { lignesOutil, markdownConversation } from '../presentationConversation.js';
import { nomAgentSession, titreConversation } from './identiteSession.js';

// Découpe des lignes (avec couleurs) à la largeur, puis garde la fenêtre visible selon le défilement
// Retire les espaces de fin (même entourés de codes couleur) : sinon les tableaux bourrés d'espaces
// produisent des lignes vides une fois coupés
const sansEspacesFinaux = (l: string) => l.replace(/(?:\s|\x1b\[[0-9;]*m)+$/, (fin) => fin.replace(/\s/g, ''));

// Chaque ligne n'est découpée qu'une fois pour une largeur donnée : le journal peut faire 5000 lignes
// et l'écran est redessiné à chaque clic, touche ou cran de molette
let largeurCache = 0;
const cache = new Map<string, string[]>();
function couper(l: string, largeur: number): string[] {
    if (!l) return [''];
    if (largeur !== largeurCache || cache.size > 20_000) {
        cache.clear();
        largeurCache = largeur;
    }
    let r = cache.get(l);
    if (!r) {
        r = wrapAnsi(sansEspacesFinaux(l), largeur, { hard: true, trim: false }).split('\n');
        cache.set(l, r);
    }
    return r;
}

export const toutesLesLignes = (lignes: string[], largeur: number) => lignes.flatMap((l) => couper(l, largeur));

// Surligne un mot dans une ligne colorée (inversion vidéo, les couleurs restent) ; les codes couleur ne sont pas touchés
export function surligner(ligne: string, terme: string): string {
    if (terme.length < 2) return ligne;
    const motif = new RegExp(terme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return ligne.split(/(\x1b\[[0-9;]*m)/).map((morceau) => (morceau.startsWith('\x1b[') ? morceau : morceau.replace(motif, (m) => `\x1b[7m${m}\x1b[27m`))).join('');
}

export function fenetre(lignes: string[], largeur: number, hauteur: number, defilement: number): { visibles: string[]; max: number } {
    const coupees = lignes.flatMap((l) => couper(l, largeur));
    const max = Math.max(0, coupees.length - hauteur);
    const fin = coupees.length - Math.min(defilement, max);
    return { visibles: coupees.slice(Math.max(0, fin - hauteur), fin), max };
}

function Lignes({ lignes, hauteur, largeur }: { lignes: string[]; hauteur: number; largeur: number }) {
    return (
        <Box flexDirection="column" height={hauteur} width={largeur} justifyContent="flex-end">
            {lignes.map((l, i) => <Text key={i} wrap="truncate-end">{l || ' '}</Text>)}
        </Box>
    );
}

// Zone principale par défaut : la sortie des commandes
export function VueJournal({ lignes, largeur, hauteur, defilement }: { lignes: string[]; largeur: number; hauteur: number; defilement: number }) {
    const { visibles, max } = fenetre(lignes, largeur - 2, hauteur, defilement);
    if (!lignes.length) {
        return (
            <Box height={hauteur} width={largeur} flexDirection="column" justifyContent="center" alignItems="center">
                <Text color={theme.accent}>✻</Text>
                <Text color="gray">Clique une session à gauche pour voir ce qu'elle fait</Text>
                <Text color="gray">Ctrl+K pour tout chercher · / pour les commandes · Alt+M pour le maître</Text>
            </Box>
        );
    }
    return (
        <Box flexDirection="column" paddingLeft={1}>
            <Lignes lignes={visibles} hauteur={hauteur - (defilement ? 1 : 0)} largeur={largeur - 1} />
            {defilement > 0 && <Text color="gray">  ↓ {Math.min(defilement, max)} lignes plus bas · molette</Text>}
        </Box>
    );
}

// Outils et résultats tiennent sur une ligne (coupée), le texte des messages est replié normalement
export function lignesTranscript(messages: Message[], largeur: number, details = false): string[] {
    const ligne = (s: string, n: number) => {
        const t = s.replace(/\s+/g, ' ').trim();
        return t.length > n ? t.slice(0, n - 1) + '…' : t;
    };
    const lignes: string[] = [];
    for (const m of messages.slice(-300)) {
        if (m.role === 'user') lignes.push('', c.accent.bold('❯ ') + c.accent(m.texte.split('\n')[0]), ...m.texte.split('\n').slice(1).map((l) => '  ' + l));
        if (m.role === 'assistant') lignes.push('', ...markdownConversation(m.texte, largeur));
        if (m.role === 'outil') lignes.push(...lignesOutil(m, largeur, details));
        if (m.role === 'resultat') lignes.push(c.discret('  ⎿ ' + ligne(m.texte, largeur - 5)));
    }
    return lignes;
}

// Conversation d'une session, en direct, avec ses boutons (positions fournies par l'appelant)
// Colonne d'actions de la conversation (à gauche ou à droite, /ecran) : une action par ligne,
// et sous la liste la description de celle qui est survolée. Lignes : titre (rangée 2 du corps), puis une par action.
function ColonneActions({ liste, hauteur, survol, cote }: { liste: ActionSession[]; hauteur: number; survol?: string; cote: 'gauche' | 'droite' }) {
    const appui = useAppui();
    const interieur = COL_ACTIONS - 1;
    const survolee = liste.find((a) => survol === `session:${a.action}`);
    const aide = survolee ? wrapAnsi(survolee.aide, interieur - 2, { hard: true }).split('\n') : ['Survole une action', 'pour voir ce', 'qu’elle fait.'];
    return (
        <Box width={COL_ACTIONS} height={hauteur} flexShrink={0} flexDirection="column" overflow="hidden"
            borderStyle="single" borderTop={false} borderBottom={false} borderLeft={cote === 'droite'} borderRight={cote === 'gauche'} borderColor={fond.bordure}>
            <Box height={1} flexShrink={0}><Text bold color={theme.primaire}>{' ACTIONS'}</Text></Box>
            {liste.map((a) => {
                const actif = survol === `session:${a.action}`;
                return (
                    <Box key={a.action} height={1} flexShrink={0} overflow="hidden">
                        <Text wrap="truncate-end" inverse={appui === `session:${a.action}`} backgroundColor={actif ? fond.selection : undefined} bold={actif}
                            color={a.action === 'fermer-session' ? '#f87171' : actif ? theme.accent : a.action === 'fermer' ? fond.eteint : fond.texte}>
                            {` ${a.label}`.padEnd(interieur)}
                        </Text>
                    </Box>
                );
            })}
            <Box height={1} flexShrink={0} />
            {aide.map((l, i) => <Box key={i} height={1} flexShrink={0}><Text color={survolee ? theme.secondaire : fond.discret} wrap="truncate-end">{` ${l}`}</Text></Box>)}
        </Box>
    );
}

export function VueSession({ s, messages, boutons, largeur, hauteur, defilement, git, surligne, cout, survol, colonne, ecart = 1 }:
    { s: SessionVue; messages: Message[]; boutons: Bouton[]; largeur: number; hauteur: number; defilement: number; git?: EtatGit; surligne?: string; cout?: number; survol?: string;
      colonne?: { cote: 'gauche' | 'droite'; liste: ActionSession[] }; ecart?: number }) {
    const appui = useAppui();
    // Colonne d'actions : la conversation prend le reste de la largeur
    const largeurTexte = colonne ? largeur - COL_ACTIONS : largeur;
    const lignes = useMemo(() => lignesTranscript(messages, largeurTexte - 2), [messages, largeurTexte]);
    // Les boutons peuvent tenir sur plusieurs rangées ; aucune s'ils sont en colonne ou cachés
    const rangees = nbRangees(boutons);
    const corps = hauteur - 2 - rangees;
    const fen = fenetre(lignes, largeurTexte - 2, corps, defilement);
    const visibles = surligne ? fen.visibles.map((l) => surligner(l, surligne)) : fen.visibles;
    return (
        <Box flexDirection="column" width={largeur} height={hauteur}>
            <Box height={1} flexShrink={0} paddingX={1} justifyContent="space-between" overflow="hidden">
                <Box flexShrink={1} overflow="hidden">
                    <Text wrap="truncate-end">
                        <Text bold color={theme.accent}>{`Agent : ${nomAgentSession(s)}`}</Text>
                        <Text color={couleurProjet(s.nom)}>{' · '}</Text>
                        <Text>{titreConversation(s)}</Text>
                        <Text color="gray">{`${s.integree ? '' : s.arrierePlan ? ` · ⧉ arrière-plan ${s.id}` : ' · ▭ onglet'}${cout ? ` · ≈ ${dollars(cout)} auj.` : ''}`}</Text>
                    </Text>
                </Box>
                {/* Ce que la session a changé dans son projet : modifs, commits à pousser */}
                {git && (
                    <Box flexShrink={0} width={Math.floor(largeur / 3)} justifyContent="flex-end" overflow="hidden">
                        <Text wrap="truncate-end">
                            <Text color={theme.secondaire}>{`  ⎇ ${git.branche}`}</Text>
                            {git.modifs ? <Text color="#facc15">{` ✎ ${git.modifs} fichier${git.modifs > 1 ? 's' : ''}`}</Text> : <Text color="#4ade80"> ✓ propre</Text>}
                            {git.enAvance ? <Text color="#facc15">{` ↑${git.enAvance} à pousser`}</Text> : null}
                            {git.enRetard ? <Text color="#f87171">{` ↓${git.enRetard}`}</Text> : null}
                        </Text>
                    </Box>
                )}
            </Box>
            {Array.from({ length: rangees }, (_, r) => (
            <Box key={r} height={1} flexShrink={0} overflow="hidden">
                {boutons.filter((b) => (b.ligne ?? 0) === r).map((b) => {
                    const principal = b.action === 'rejoindre' || b.action === 'copie';
                    const appuye = appui === `session:${b.action}`;
                    return (
                        <Box key={b.action} marginRight={ecart} flexShrink={0}>
                            <Text inverse={appuye} backgroundColor={survol === `session:${b.action}` ? fond.panneauActif : fond.selection} bold={principal || survol === `session:${b.action}`}
                                color={principal ? theme.accent : b.action === 'fermer-session' ? '#f87171' : theme.secondaire}>
                                {` ${b.label} `}
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            ))}
            <Box height={1} flexShrink={0}><Text color={fond.bordure}>{'─'.repeat(largeur)}</Text></Box>
            <Box flexDirection="row" height={corps}>
                {colonne?.cote === 'gauche' && <ColonneActions liste={colonne.liste} hauteur={corps} survol={survol} cote="gauche" />}
                <Box paddingLeft={1} width={largeurTexte}>
                    <Lignes lignes={visibles} hauteur={corps} largeur={largeurTexte - 2} />
                </Box>
                {colonne?.cote === 'droite' && <ColonneActions liste={colonne.liste} hauteur={corps} survol={survol} cote="droite" />}
            </Box>
        </Box>
    );
}

export function BarreHaut({ boutons, largeur, droite, vueActive, survol }: { boutons: Bouton[]; largeur: number; droite: string; vueActive?: string; survol?: string }) {
    const appui = useAppui();
    return (
        // Hauteur 1 stricte : si la barre passait sur 2 lignes, tout l'écran descendrait d'une ligne
        <Box width={largeur} height={1} overflow="hidden" justifyContent="space-between">
            <Box flexShrink={1} overflow="hidden">
                <Text bold>{` ${degrade('✻ ' + titreBarre, theme.accent, theme.primaire)} `}</Text>
                {boutons.map((b) => {
                    const appuye = appui === `haut:${b.action}`;
                    const ouvert = vueActive === b.action;
                    const survole = survol === `haut:${b.action}`;
                    // Icône en couleur, vue ouverte en pastille pleine, survol sur fond de sélection
                    // Sans icône (/ecran) : « Projets » seul ; « ⋯ » est une icône seule
                    const [icone, ...mots] = b.label.includes(' ') || b.label === '⋯' ? b.label.split(' ') : ['', b.label];
                    const texte = mots.join(' ');
                    const fondB = ouvert || appuye ? theme.accent : survole ? fond.selection : undefined;
                    return (
                        <Box key={b.action} marginRight={1} flexShrink={0}>
                            <Text backgroundColor={fondB} bold={ouvert || survole}>
                                <Text color={ouvert || appuye ? fond.panneau : theme.secondaire}>{` ${icone}${icone && texte ? ' ' : ''}`}</Text>
                                <Text color={ouvert || appuye ? fond.panneau : fond.texte}>{`${texte} `}</Text>
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            <Box flexShrink={0}><Text color="gray">{droite} </Text></Box>
        </Box>
    );
}

// Nom affiché en haut à gauche (personnalisable dans Configuration)
let titreBarre = (chargerConfig().banniere || 'AGENTOPIA').toUpperCase();
export function definirTitre(t: string): void {
    titreBarre = (t || 'AGENTOPIA').toUpperCase();
}
// Largeur du titre : les boutons de la barre du haut commencent juste après
export const largeurTitre = () => stringWidth(` ✻ ${titreBarre} `);   // même largeur avec le dégradé (couleurs seulement)
