import { Box, Text, useInput } from 'ink';
import { useTailleVue, useClicsVue, Separateur, Titre } from './Vues.js';
import { theme, fond } from '../theme.js';
import { creerUseConfig } from './useConfig.js';
export { lireEtatConfig, lignesConfig, type EtatConfig, type LigneConfig } from './configModele.js';
const useConfig = creerUseConfig({ useEffect, useRef, useState });

export function VueConfig({ fermer }: { fermer: () => void }) {
    const { largeur, hauteur } = useTailleVue();
    const vue = useConfig(fermer), visibles = Math.max(1, hauteur - 8);
    const debut = Math.max(0, Math.min(vue.courant - Math.floor(visibles / 2), vue.lignes.length - visibles));
    const colLabel = Math.min(26, Math.max(12, Math.floor(largeur * .35)));
    const selection = vue.selection?.type === 'reglage' ? vue.selection : undefined;
    useClicsVue((_, y) => { const i = y - 3 + debut; if (y >= 3 && y < 3 + visibles) vue.activer(i); }, sens => vue.naviguer(-sens));
    useInput((input, key) => vue.clavier(input, key.escape ? 'escape' : key.upArrow ? 'up' : key.downArrow ? 'down' : key.return ? 'return' : key.backspace ? 'backspace' : key.delete ? 'delete' : '', key.ctrl, key.meta));
    return (
        <Box flexDirection="column" width={largeur} height={hauteur} paddingLeft={1}>
            <Titre texte="CONFIGURATION" droite="/ rechercher" />
            <Separateur largeur={Math.max(0, largeur - 2)} />
            <Box height={1}><Text wrap="truncate-end" color={vue.edition ? theme.accent : fond.discret}>{vue.edition || vue.recherche ? `⌕ ${vue.recherche} · Échap effacer` : '/ pour rechercher · ↑↓ choisir · Entrée ouvrir'}</Text></Box>
            <Box flexDirection="column" height={visibles} flexShrink={0}>
                {!vue.lignes.length && <Text color={fond.discret}>Aucun réglage trouvé · Échap effacer</Text>}
                {vue.lignes.slice(debut, debut + visibles).map((l, relatif) => {
                    const i = debut + relatif, actif = i === vue.courant;
                    if (l.type === 'section') return <Box key={i} height={1}><Text bold color={theme.primaire}>{` ${l.texte}`}</Text></Box>;
                    return <Box key={i} height={1} overflow="hidden">
                        <Box width={3} flexShrink={0}><Text color={actif ? theme.accent : 'gray'}>{actif ? ' ❯ ' : '   '}</Text></Box>
                        <Box width={colLabel} flexShrink={0}><Text wrap="truncate-end" backgroundColor={actif ? fond.selection : undefined}>{l.label}</Text></Box>
                        <Box flexGrow={1} minWidth={0}><Text wrap="truncate-end" color={l.couleur ?? theme.secondaire} backgroundColor={actif ? fond.selection : undefined}>{l.valeur}</Text></Box>
                        {largeur >= 105 && <Box width={25} flexShrink={0}><Text wrap="truncate-end" color={fond.discret}>{` ${l.aide} ›`}</Text></Box>}
                    </Box>;
                })}
            </Box>
            <Separateur largeur={Math.max(0, largeur - 2)} />
            <Box height={1}><Text bold color={theme.accent} wrap="truncate-end">{selection?.label || 'Recherche des réglages'}</Text></Box>
            <Box height={2} overflow="hidden"><Text color={selection?.couleur ?? theme.secondaire}>{selection?.valeur || 'Change les mots recherchés pour retrouver un réglage.'}</Text></Box>
            <Box height={1}><Text wrap="truncate-end" color={fond.discret}>{selection ? `${selection.aide} · Entrée ouvrir · Échap retour` : 'Échap effacer la recherche'}</Text></Box>
        </Box>
    );
}
import { useEffect, useRef, useState } from 'react';
