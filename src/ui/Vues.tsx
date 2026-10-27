import { useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';
import { bus } from './bus.js';
import { Bouton, calculerMise } from './mise.js';
import { theme } from '../theme.js';

// Outils communs aux vues plein cadre (Docker, Serveurs) : taille, clics, boutons

export function useTailleVue(): { largeur: number; hauteur: number } {
    const { stdout } = useStdout();
    const m = calculerMise(stdout.columns || 110, stdout.rows || 34);
    return { largeur: m.principal, hauteur: m.corps };
}

// L'App envoie les clics et la molette de la zone principale, en coordonnées relatives à la vue
export function useClicsVue(surClic: (x: number, y: number) => void, surMolette?: (sens: number) => void): void {
    const ref = useRef({ surClic, surMolette });
    ref.current = { surClic, surMolette };
    useEffect(() => {
        const clic = ({ x, y }: { x: number; y: number }) => ref.current.surClic(x, y);
        const molette = (sens: number) => ref.current.surMolette?.(sens);
        bus.on('clic-vue', clic);
        bus.on('molette-vue', molette);
        return () => {
            bus.off('clic-vue', clic);
            bus.off('molette-vue', molette);
        };
    }, []);
}

export function LigneBoutons({ boutons, actifs }: { boutons: Bouton[]; actifs?: Set<string> }) {
    return (
        // Les boutons gardent leur largeur (sinon les clics ne tombent plus dessus) ; ce qui dépasse est coupé
        <Box height={1} flexShrink={0} overflow="hidden">
            {boutons.map((b) => {
                const actif = !actifs || actifs.has(b.action);
                return (
                    <Box key={b.action} marginRight={1} flexShrink={0}>
                        <Text backgroundColor={actif ? '#1e293b' : undefined} color={actif ? theme.secondaire : '#475569'} bold={actif}>{` ${b.label} `}</Text>
                    </Box>
                );
            })}
        </Box>
    );
}

export function Separateur({ largeur }: { largeur: number }) {
    return <Box height={1} flexShrink={0}><Text color="#334155">{'─'.repeat(largeur)}</Text></Box>;
}

export function Titre({ texte, droite }: { texte: string; droite?: string }) {
    return (
        <Box height={1} flexShrink={0} justifyContent="space-between" paddingRight={1} overflow="hidden">
            <Box flexShrink={0}><Text bold color={theme.primaire}>{texte + '   '}</Text></Box>
            <Box flexShrink={1} overflow="hidden"><Text color="gray" wrap="truncate-end">{droite ?? ''}</Text></Box>
        </Box>
    );
}
