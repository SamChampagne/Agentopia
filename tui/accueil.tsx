import { useEffect, useState } from 'react';
import { GRAS } from './style.ts';
import { chargerConfig } from '../dist/config.js';
import { theme, fond, lignesBanniere, melange } from '../dist/theme.js';

// Écran d'accueil (quelques secondes au lancement) et mascotte de la barre du haut

// Dégradé qui glisse : chaque caractère prend sa couleur selon sa position et la phase de l'animation
const vague = (i: number, largeur: number, phase: number) => {
    const t = (Math.sin(((i / largeur) * 2 - phase) * Math.PI) + 1) / 2;
    return melange(theme.primaire, theme.accent, t);
};

export function Accueil({ largeur, hauteur, d, fermer }: { largeur: number; hauteur: number; d: any; fermer: () => void }) {
    const [phase, setPhase] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setPhase((p) => p + 0.08), 60);
        return () => clearInterval(t);
    }, []);
    const lignes: string[] = lignesBanniere();
    const l = Math.max(...lignes.map((x) => [...x].length));
    const prenom = chargerConfig().prenom;
    const actives = d.agents.filter((a: any) => a.statut !== 'terminee');
    const attendent = actives.filter((a: any) => a.statut === 'bloquee' || a.statut === 'attend').length;
    const resume = !d.agents.length ? 'lecture des sessions…'
        : `${actives.length} session${actives.length > 1 ? 's' : ''} active${actives.length > 1 ? 's' : ''}${attendent ? ` · ${attendent} t'attend${attendent > 1 ? 'ent' : ''}` : ''}`;
    // L'apparition : la bannière se dévoile de gauche à droite en moins d'une seconde
    const visibles = Math.min(l, Math.floor(phase * 60));
    return (
        <box width={largeur} height={hauteur} backgroundColor="#0c0c0c" flexDirection="column" alignItems="center" justifyContent="center" onMouseDown={fermer}>
            {lignes.map((ligne, n) => (
                <text key={n}>
                    {[...ligne].map((ch, i) => <span key={i} fg={vague(i, l, phase)}>{i < visibles ? ch : ' '}</span>)}
                </text>
            ))}
            <text> </text>
            <text fg={fond.texte} attributes={GRAS}>{`${Mascotte.visage(d, Math.floor(phase * 3))}  ${prenom ? `Bonjour ${prenom} !` : 'Bonjour !'}`}</text>
            <text fg={fond.eteint}>{resume}</text>
            <text> </text>
            <text fg={fond.discret}>une touche ou un clic pour commencer</text>
        </box>
    );
}

// La mascotte réagit à l'état des sessions : elle dort, travaille, ou attend ton aide
export const Mascotte = {
    etat(d: any): { visage: string; texte: string; couleur: string } {
        const bloquees = d.agents.filter((a: any) => a.statut === 'bloquee').length;
        const travaillent = d.agents.filter((a: any) => a.statut === 'travaille').length;
        const attendent = d.agents.filter((a: any) => a.statut === 'attend').length;
        if (bloquees) return { visage: 'alerte', texte: `${bloquees} a besoin de toi`, couleur: '#fb923c' };
        if (travaillent) return { visage: 'travail', texte: `${travaillent} au travail`, couleur: '#4ade80' };
        if (attendent) return { visage: 'attente', texte: `${attendent} t'attend${attendent > 1 ? 'ent' : ''}`, couleur: '#facc15' };
        return { visage: 'dort', texte: 'tout est calme', couleur: fond.eteint };
    },
    visage(d: any, tic: number): string {
        const v = Mascotte.etat(d).visage;
        if (v === 'alerte') return tic % 2 ? '(°o°)!' : '(°o°) ';
        if (v === 'travail') return ['(•‿•)╯', '(•‿•)━', '(•‿•)╮', '(•‿•)━'][tic % 4];
        if (v === 'attente') return tic % 4 === 3 ? '(-‿•)?' : '(•‿•)?';
        return ['(-.-)  ', '(-.-)z ', '(-.-)zZ'][tic % 3];
    },
};
