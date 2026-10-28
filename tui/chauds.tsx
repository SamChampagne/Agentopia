import * as path from 'path';
import { useState } from 'react';
import { GRAS, couper } from './style.ts';
import { fichiersChauds } from '../dist/modifications.js';
import { theme, fond, couleurProjet, melange } from '../dist/theme.js';

// Fichiers chauds : ce que toutes les sessions modifient dans la dernière demi-heure.
// Un fichier touché il y a quelques secondes s'illumine ; deux sessions actives sur le même fichier = conflit possible.

const FENETRE = 30 * 60_000;
const ECLAT = 15_000;          // un fichier « s'allume » pendant 15 s après chaque modification

const ilYaCourt = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

// Chemin lisible : relatif au dossier de la session qui l'a touché, sinon le nom du fichier et son dossier
function nomCourt(chemin: string, sessions: any[]): string {
    for (const s of sessions) {
        const r = path.relative(s.cwd, chemin);
        if (!r.startsWith('..') && !path.isAbsolute(r)) return r.replace(/\\/g, '/');
    }
    return `${path.basename(path.dirname(chemin))}/${path.basename(chemin)}`;
}

export function Chauds({ d, largeur, tic, ouvrir }: { d: any; largeur: number; tic: number; ouvrir: (cle: string) => void }) {
    const [survol, setSurvol] = useState<string>();
    const maintenant = Date.now();
    const fichiers = fichiersChauds(d.agents, FENETRE, maintenant);
    const conflits = fichiers.filter((f: any) => f.conflit).length;
    const maxModifs = Math.max(1, ...fichiers.map((f: any) => f.modifications.length));
    const largeurNom = Math.max(20, Math.min(60, largeur - 58));
    return (
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
            <text truncate>
                <span fg="#fb923c" attributes={GRAS}>♨ FICHIERS CHAUDS</span>
                <span fg="gray">{`  ${fichiers.length} fichier${fichiers.length > 1 ? 's' : ''} modifié${fichiers.length > 1 ? 's' : ''} ces 30 dernières minutes`}</span>
                {conflits > 0 && <span fg="#f87171" attributes={GRAS}>{`  ⚠ ${conflits} conflit${conflits > 1 ? 's' : ''} possible${conflits > 1 ? 's' : ''}`}</span>}
            </text>
            <text fg={fond.discret}>{'  clic : ouvrir la session qui l’a touché en dernier · Échap ou Alt+H pour revenir'}</text>
            <box height={1} border={['bottom']} borderColor={fond.bordure} />
            {!fichiers.length && <text fg={fond.eteint}>{'\n  Rien de modifié ces 30 dernières minutes. Quand une session édite un fichier, il apparaît ici et s’allume.'}</text>}
            <scrollbox verticalScrollbarOptions={{ visible: false }} flexGrow={1} scrollY>
                {fichiers.map((f: any) => {
                    const age = maintenant - f.modifications[0].date;
                    // L'éclat : vif juste après la modification, puis s'éteint ; il clignote tant qu'il est récent
                    const eclat = age < ECLAT ? 1 - age / ECLAT : 0;
                    const fondLigne = survol === f.chemin ? fond.selection : eclat ? melange('#0c0c0c', f.conflit ? '#7f1d1d' : '#9a3412', eclat * (tic % 2 ? 0.9 : 0.6)) : undefined;
                    const n = f.modifications.length;
                    const chaleur = n / maxModifs;
                    const couleurChaleur = chaleur > 0.66 ? '#f87171' : chaleur > 0.33 ? '#fb923c' : '#facc15';
                    const barre = '▮'.repeat(Math.max(1, Math.round(chaleur * 8))).padEnd(8, ' ');
                    return (
                        <box key={f.chemin} height={1} flexDirection="row" backgroundColor={fondLigne}
                            onMouseOver={() => setSurvol(f.chemin)} onMouseOut={() => setSurvol(undefined)}
                            onMouseDown={() => ouvrir(f.modifications[0].session.cle)}>
                            <text fg={f.conflit ? '#f87171' : eclat ? theme.accent : fond.discret}>{f.conflit ? ' ⚠ ' : eclat ? ' ✎ ' : '   '}</text>
                            <text fg={couleurChaleur}>{barre}</text>
                            <text fg="gray">{` ${String(n).padStart(3)}× `}</text>
                            <text fg={eclat ? fond.texte : '#cbd5e1'} attributes={eclat ? GRAS : 0} truncate>{couper(nomCourt(f.chemin, f.sessions), largeurNom).padEnd(largeurNom)}</text>
                            <text truncate flexGrow={1}>
                                {f.sessions.slice(0, 3).map((s: any, i: number) => (
                                    <span key={s.cle} fg={couleurProjet(s.nom)}>{`${i ? ' ' : ' '}● ${couper(s.titre || s.nom, 18)}`}</span>
                                ))}
                                {f.sessions.length > 3 && <span fg="gray">{` +${f.sessions.length - 3}`}</span>}
                            </text>
                            <text fg={eclat ? theme.accent : fond.discret}>{`${ilYaCourt(age).padStart(7)} `}</text>
                        </box>
                    );
                })}
            </scrollbox>
        </box>
    );
}
