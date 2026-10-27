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
import { Bouton } from './mise.js';
import { theme, couleurProjet, c, fond, degrade } from '../theme.js';
import { ligneMarkdown } from '../affichage.js';

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
export function lignesTranscript(messages: Message[], largeur: number): string[] {
    const ligne = (s: string, n: number) => {
        const t = s.replace(/\s+/g, ' ').trim();
        return t.length > n ? t.slice(0, n - 1) + '…' : t;
    };
    const lignes: string[] = [];
    for (const m of messages.slice(-300)) {
        if (m.role === 'user') lignes.push('', c.accent.bold('❯ ') + c.accent(m.texte.split('\n')[0]), ...m.texte.split('\n').slice(1).map((l) => '  ' + l));
        if (m.role === 'assistant') lignes.push('', ...m.texte.split('\n').map(ligneMarkdown));
        if (m.role === 'outil') lignes.push(c.secondaire('▸ ') + c.discret(ligne(m.texte, largeur - 3)));
        if (m.role === 'resultat') lignes.push(c.discret('  ⎿ ' + ligne(m.texte, largeur - 5)));
    }
    return lignes;
}

// Conversation d'une session, en direct, avec ses boutons (positions fournies par l'appelant)
export function VueSession({ s, messages, boutons, largeur, hauteur, defilement, git, surligne, cout }:
    { s: SessionVue; messages: Message[]; boutons: Bouton[]; largeur: number; hauteur: number; defilement: number; git?: EtatGit; surligne?: string; cout?: number }) {
    const appui = useAppui();
    const lignes = useMemo(() => lignesTranscript(messages, largeur - 2), [messages, largeur]);
    const fen = fenetre(lignes, largeur - 2, hauteur - 3, defilement);
    const visibles = surligne ? fen.visibles.map((l) => surligner(l, surligne)) : fen.visibles;
    return (
        <Box flexDirection="column" width={largeur} height={hauteur}>
            <Box height={1} flexShrink={0} paddingX={1} justifyContent="space-between" overflow="hidden">
                <Box flexShrink={1} overflow="hidden">
                    <Text wrap="truncate-end">
                        <Text color={couleurProjet(s.nom)}>● </Text>
                        <Text bold>{s.nom}</Text>
                        <Text color="gray">{`  ${s.arrierePlan ? `⧉ arrière-plan ${s.id}` : '▭ onglet'} · ${s.titre}${cout ? ` · ≈ ${dollars(cout)} auj.` : ''}`}</Text>
                    </Text>
                </Box>
                {/* Ce que la session a changé dans son projet : modifs, commits à pousser */}
                {git && (
                    <Box flexShrink={0}>
                        <Text>
                            <Text color={theme.secondaire}>{`  ⎇ ${git.branche}`}</Text>
                            {git.modifs ? <Text color="#facc15">{` ✎ ${git.modifs} fichier${git.modifs > 1 ? 's' : ''}`}</Text> : <Text color="#4ade80"> ✓ propre</Text>}
                            {git.enAvance ? <Text color="#facc15">{` ↑${git.enAvance} à pousser`}</Text> : null}
                            {git.enRetard ? <Text color="#f87171">{` ↓${git.enRetard}`}</Text> : null}
                        </Text>
                    </Box>
                )}
            </Box>
            <Box height={1} flexShrink={0} overflow="hidden">
                {boutons.map((b) => {
                    const principal = b.action === 'rejoindre' || b.action === 'copie';
                    const appuye = appui === `session:${b.action}`;
                    return (
                        <Box key={b.action} marginRight={1} flexShrink={0}>
                            <Text inverse={appuye} backgroundColor={fond.selection} bold={principal}
                                color={principal ? theme.accent : b.action === 'fermer-session' ? '#f87171' : theme.secondaire}>
                                {` ${b.label} `}
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            <Box height={1} flexShrink={0}><Text color={fond.bordure}>{'─'.repeat(largeur)}</Text></Box>
            <Box paddingLeft={1}>
                <Lignes lignes={visibles} hauteur={hauteur - 3} largeur={largeur - 2} />
            </Box>
        </Box>
    );
}

export function BarreHaut({ boutons, largeur, droite, vueActive }: { boutons: Bouton[]; largeur: number; droite: string; vueActive?: string }) {
    const appui = useAppui();
    return (
        // Hauteur 1 stricte : si la barre passait sur 2 lignes, tout l'écran descendrait d'une ligne
        <Box width={largeur} height={1} overflow="hidden" justifyContent="space-between">
            <Box flexShrink={1} overflow="hidden">
                <Text bold>{` ${degrade('✻ ' + titreBarre, theme.accent, theme.primaire)} `}</Text>
                {boutons.map((b) => {
                    // Sans fond : appuyé = inversé un instant · vue ouverte = couleur d'accent soulignée
                    const appuye = appui === `haut:${b.action}`;
                    const ouvert = vueActive === b.action;
                    return (
                        <Box key={b.action} marginRight={1} flexShrink={0}>
                            <Text inverse={appuye} color={ouvert || appuye ? theme.accent : fond.eteint} bold={ouvert} underline={ouvert}>{` ${b.label} `}</Text>
                        </Box>
                    );
                })}
            </Box>
            <Box flexShrink={0}><Text color="gray">{droite} </Text></Box>
        </Box>
    );
}

// Nom affiché en haut à gauche (personnalisable dans Configuration)
let titreBarre = (chargerConfig().banniere || 'CLAUDETOPIA').toUpperCase();
export function definirTitre(t: string): void {
    titreBarre = (t || 'CLAUDETOPIA').toUpperCase();
}
// Largeur du titre : les boutons de la barre du haut commencent juste après
export const largeurTitre = () => stringWidth(` ✻ ${titreBarre} `);   // même largeur avec le dégradé (couleurs seulement)
