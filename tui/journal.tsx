import { Ansi } from './ansi.tsx';
import { GRAS } from './style.ts';
import { lignesJournal } from '../dist/ui/journal.js';
import { theme, fond } from '../dist/theme.js';

// Journal complet des commandes : défilement natif, collé en bas, texte sélectionnable
export function Journal() {
    const lignes = lignesJournal();
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <text><span fg={theme.accent} attributes={GRAS}>▤ JOURNAL </span><span fg={fond.discret}>Échap pour revenir au cockpit · molette pour défiler · /clear pour vider</span></text>
            <scrollbox flexGrow={1} scrollY stickyScroll stickyStart="bottom">
                {lignes.slice(-2000).map((l: string, i: number) => <Ansi key={i} texte={l} selectionnable />)}
            </scrollbox>
        </box>
    );
}
