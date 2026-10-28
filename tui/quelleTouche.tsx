import { GRAS } from './style.ts';
import { noeudA, estGroupe } from '../dist/ui/quelleTouche.js';
import { theme, fond } from '../dist/theme.js';

// « Quelle touche ? » : Espace dans une saisie vide ouvre la carte des actions (même arbre que l'interface Ink).
// Une lettre descend dans un groupe ou lance l'action ; un clic aussi.

export function QuelleTouche({ chemin, choisir }: { chemin: string; choisir: (touche: string) => void }) {
    const groupe = noeudA(chemin);
    const entrees = Object.entries(groupe.enfants) as [string, any][];
    const colonnes = 3;
    const lignes = Math.ceil(entrees.length / colonnes);
    return (
        <box flexShrink={0} flexDirection="column" border={['top']} borderStyle="rounded" borderColor={theme.accent} paddingLeft={1}>
            <text>
                <span fg={theme.accent} attributes={GRAS}>{`␣ ${chemin ? chemin.split('').join(' ') + ' · ' : ''}${groupe.nom}`}</span>
                <span fg={fond.discret}>{'   lettre ou clic = choisir · ⌫ remonter · Échap fermer'}</span>
            </text>
            {Array.from({ length: lignes }, (_, l) => (
                <box key={l} height={1} flexDirection="row">
                    {entrees.slice(l * colonnes, l * colonnes + colonnes).map(([t, n]) => (
                        <box key={t} width={34} onMouseDown={() => choisir(t)}>
                            <text truncate>
                                <span fg={theme.accent} attributes={GRAS}>{` ${t} `}</span>
                                <span fg={estGroupe(n) ? theme.secondaire : fond.texte}>{` ${n.nom}${estGroupe(n) ? ' ›' : ''}`}</span>
                            </text>
                        </box>
                    ))}
                </box>
            ))}
        </box>
    );
}
