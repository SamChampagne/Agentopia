import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Choix, bus } from './bus.js';
import { theme } from '../theme.js';
import { visible } from '../affichage.js';
import { correspond } from '../projets.js';

const HAUTEUR = 10;

interface Props {
    message: string;
    choix: Choix<unknown>[];
    recherche: boolean;
    multiple: boolean;
    onFin: (valeur: unknown) => void;
}

// Liste de choix navigable au clavier, avec filtre et cases à cocher optionnels
export function Selecteur({ message, choix, recherche, multiple, onFin }: Props) {
    const [filtre, setFiltre] = useState('');
    const [index, setIndex] = useState(0);
    const [coches, setCoches] = useState(() => new Set(choix.filter((x) => x.coche).map((x) => x.valeur)));

    const filtres = choix.filter((x) => !filtre || correspond(visible(x.label) + ' ' + (x.description ?? ''), filtre));
    const courant = Math.min(index, Math.max(0, filtres.length - 1));
    const debut = Math.max(0, Math.min(courant - Math.floor(HAUTEUR / 2), filtres.length - HAUTEUR));
    const visibles = filtres.slice(debut, debut + HAUTEUR);

    // Clic : l'App envoie la ligne cliquée relative au haut du sélecteur.
    // Bordure (0), titre (1), puis [recherche (2), espace (3)], puis les éléments.
    const premiereLigne = recherche ? 4 : 2;
    const surClic = useRef<(ligne: number) => void>(() => undefined);
    surClic.current = (ligne) => {
        const i = ligne - premiereLigne;
        // Ligne du bas (« ✕ Annuler … ») : on ferme le menu
        if (i === Math.max(1, visibles.length)) return onFin(undefined);
        const x = visibles[i];
        if (i < 0 || !x) return;
        setIndex(debut + i);
        if (!multiple) return onFin(x.valeur);
        const suivant = new Set(coches);
        if (suivant.has(x.valeur)) suivant.delete(x.valeur);
        else suivant.add(x.valeur);
        setCoches(suivant);
    };
    useEffect(() => {
        const f = (ligne: number) => surClic.current(ligne);
        bus.on('clic-selecteur', f);
        return () => {
            bus.off('clic-selecteur', f);
        };
    }, []);

    useInput((input, key) => {
        if (key.escape) return onFin(undefined);
        if (key.upArrow) return setIndex((i) => (Math.min(i, filtres.length - 1) - 1 + filtres.length) % Math.max(1, filtres.length));
        if (key.downArrow) return setIndex((i) => (Math.min(i, filtres.length - 1) + 1) % Math.max(1, filtres.length));
        if (key.pageDown) return setIndex((i) => Math.min(filtres.length - 1, i + HAUTEUR));
        if (key.pageUp) return setIndex((i) => Math.max(0, i - HAUTEUR));
        // "a" : tout cocher / tout décocher
        if (multiple && input === 'a' && !recherche) {
            return setCoches(coches.size === choix.length ? new Set() : new Set(choix.map((x) => x.valeur)));
        }
        if (multiple && input === ' ') {
            const v = filtres[courant]?.valeur;
            const suivant = new Set(coches);
            if (suivant.has(v)) suivant.delete(v);
            else suivant.add(v);
            return setCoches(suivant);
        }
        if (key.return) {
            if (multiple) return onFin(choix.filter((x) => coches.has(x.valeur)).map((x) => x.valeur));
            if (filtres[courant]) onFin(filtres[courant].valeur);
        }
    });

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={theme.primaire} paddingX={1}>
            <Text bold color={theme.primaire}>{message}</Text>
            {recherche && (
                <Box>
                    <Text color="gray">⌕ </Text>
                    <TextInput
                        value={filtre}
                        onChange={(v) => { setFiltre(v); setIndex(0); }}
                        placeholder="tape pour filtrer…"
                    />
                </Box>
            )}
            <Box flexDirection="column" marginTop={recherche ? 1 : 0}>
                {visibles.length === 0 && <Text color="gray">  Aucun résultat</Text>}
                {visibles.map((x, i) => {
                    const actif = debut + i === courant;
                    return (
                        <Box key={debut + i}>
                            <Text color={actif ? theme.accent : undefined} wrap="truncate-end">
                                {actif ? '❯ ' : '  '}
                                {multiple ? (coches.has(x.valeur) ? '◉ ' : '◯ ') : ''}
                                {x.label}
                                {x.description ? <Text color="gray">{'  ' + x.description}</Text> : null}
                            </Text>
                        </Box>
                    );
                })}
            </Box>
            <Text color="gray" wrap="truncate-end">
                <Text color="#f87171">✕ Annuler</Text>
                {'   '}
                {filtres.length > HAUTEUR ? `${courant + 1}/${filtres.length} · ` : ''}
                ↑↓ naviguer · {multiple ? `Espace cocher · a tout · ${coches.size} coché${coches.size > 1 ? 's' : ''} · ` : ''}Entrée valider · Échap annuler
            </Text>
        </Box>
    );
}

export function Saisie({ message, defaut, masque, onFin }: { message: string; defaut: string; masque?: boolean; onFin: (v: string | undefined) => void }) {
    const [valeur, setValeur] = useState(defaut);
    useInput((_, key) => {
        if (key.escape) onFin(undefined);
    });
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={theme.primaire} paddingX={1}>
            <Text bold color={theme.primaire}>{message}</Text>
            <Box>
                <Text color={theme.accent}>❯ </Text>
                <TextInput value={valeur} onChange={setValeur} onSubmit={(v) => v.trim() && onFin(v.trim())} mask={masque ? '•' : undefined} />
            </Box>
            <Text color="gray">Entrée valider · Échap annuler</Text>
        </Box>
    );
}
