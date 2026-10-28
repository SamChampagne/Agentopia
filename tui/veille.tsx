import { useEffect, useRef, useState } from 'react';
import { GRAS } from './style.ts';
import { theme, fond, couleurProjet, melange } from '../dist/theme.js';

// Écran de veille : une pluie de caractères aux couleurs du thème, et par-dessus la constellation des sessions.
// Chaque session est une étoile, toujours à la même place, qui pulse selon son état ; les sessions d'un même projet sont reliées.
// Une touche ou la souris ramène l'interface.

const NOIR = '#0c0c0c';
const SIGNES = '0123456789abcdef{}<>=+*/;:.✻';
const CHIFFRES: Record<string, [string, string]> = {
    0: ['█▀█', '█▄█'], 1: ['▄█ ', ' █ '], 2: ['▀▀█', '█▄▄'], 3: ['▀▀█', '▄▄█'], 4: ['█ █', '▀▀█'],
    5: ['█▀▀', '▄▄█'], 6: ['█▀▀', '█▄█'], 7: ['▀▀█', '  █'], 8: ['█▀█', '█▀█'], 9: ['█▀█', '▀▀█'], ':': [' ▪ ', ' ▪ '],
};

interface Goutte { y: number; vitesse: number; longueur: number }
type Cellule = { ch: string; fg: string };

// Position stable d'une session : dérivée de son identifiant
function hachage(texte: string): number {
    let h = 2166136261;
    for (const ch of texte) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return (h >>> 0) / 4294967295;
}

const COULEURS: Record<string, string> = { travaille: '#4ade80', attend: '#facc15', bloquee: '#fb923c', terminee: '#94a3b8' };

export function Veille({ largeur, hauteur, d, reveiller }: { largeur: number; hauteur: number; d: any; reveiller: () => void }) {
    const [frame, setFrame] = useState(0);
    const gouttes = useRef<Goutte[]>([]);
    const signes = useRef<string[]>([]);
    useEffect(() => {
        const t = setInterval(() => setFrame((f) => f + 1), 90);
        return () => clearInterval(t);
    }, []);
    // Une colonne sur deux a sa goutte, qui repart d'en haut au hasard
    if (gouttes.current.length !== largeur) {
        gouttes.current = Array.from({ length: largeur }, () => ({ y: -Math.random() * hauteur * 2, vitesse: 0.3 + Math.random() * 0.7, longueur: 4 + Math.floor(Math.random() * 12) }));
        signes.current = Array.from({ length: largeur * hauteur }, () => SIGNES[Math.floor(Math.random() * SIGNES.length)]);
    }
    for (const g of gouttes.current) {
        g.y += g.vitesse;
        if (g.y - g.longueur > hauteur) Object.assign(g, { y: -Math.random() * hauteur, vitesse: 0.3 + Math.random() * 0.7, longueur: 4 + Math.floor(Math.random() * 12) });
    }
    // Quelques signes changent à chaque image
    for (let i = 0; i < largeur / 3; i++) signes.current[Math.floor(Math.random() * signes.current.length)] = SIGNES[Math.floor(Math.random() * SIGNES.length)];

    // La pluie, en 4 intensités (moins de morceaux de couleur à dessiner)
    const teintes = [0.12, 0.25, 0.45, 0.75].map((t) => melange(NOIR, theme.primaire, t));
    const tete = melange(theme.primaire, '#ffffff', 0.6);
    const grille: Cellule[][] = Array.from({ length: hauteur }, (_, y) => Array.from({ length: largeur }, (_, x) => {
        const g = gouttes.current[x];
        if (x % 2) return { ch: ' ', fg: NOIR };
        const distance = g.y - y;
        if (distance < 0 || distance > g.longueur) return { ch: ' ', fg: NOIR };
        const ch = signes.current[y * largeur + x];
        if (distance < 1) return { ch, fg: tete };
        return { ch, fg: teintes[Math.min(3, Math.floor((1 - distance / g.longueur) * 4))] };
    }));
    const poser = (x: number, y: number, ch: string, fg: string) => {
        if (y >= 0 && y < hauteur && x >= 0 && x < largeur) grille[y][x] = { ch, fg };
    };
    const ecrire = (x: number, y: number, texte: string, fg: string) => [...texte].forEach((ch, i) => poser(x + i, y, ch, fg));

    // La constellation : les sessions actives, reliées par projet
    const sessions = d.agents.filter((s: any) => s.statut !== 'terminee');
    const zoneHaut = Math.max(3, Math.floor(hauteur * 0.62));
    const etoiles = sessions.map((s: any) => ({
        s,
        x: Math.floor(largeur * (0.1 + 0.8 * hachage(s.sessionId))),
        y: 2 + Math.floor((zoneHaut - 4) * hachage(`${s.sessionId}·y`)),
    }));
    for (let i = 0; i < etoiles.length; i++) {
        for (let j = i + 1; j < etoiles.length; j++) {
            if (etoiles[i].s.nom !== etoiles[j].s.nom) continue;
            const a = etoiles[i], b = etoiles[j];
            const pas = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
            for (let k = 1; k < pas; k++) {
                if (k % 2) continue;
                poser(Math.round(a.x + ((b.x - a.x) * k) / pas), Math.round(a.y + ((b.y - a.y) * k) / pas), '·', melange(NOIR, couleurProjet(a.s.nom), 0.6));
            }
        }
    }
    for (const { s, x, y } of etoiles) {
        const phase = (frame + Math.floor(hachage(s.sessionId) * 10)) % 10;
        const couleur = s.statut === 'bloquee' ? (phase < 5 ? '#fb923c' : '#7c2d12') : COULEURS[s.statut] ?? fond.eteint;
        const ch = s.statut === 'travaille' ? ['✦', '✧', '✶', '✷', '✸', '✹', '✸', '✷', '✶', '✧'][phase] : s.statut === 'bloquee' ? '✸' : '✧';
        // Un halo autour des étoiles qui travaillent
        if (s.statut === 'travaille' && phase >= 3 && phase <= 7) {
            for (const [dx, dy] of [[-2, 0], [2, 0], [0, -1], [0, 1]]) poser(x + dx, y + dy, '·', melange(NOIR, couleur, 0.5));
        }
        poser(x, y, ch, couleur);
        const nom = s.titre && s.titre.length < 24 ? `${s.nom} · ${s.titre}` : s.nom;
        ecrire(x - Math.floor(nom.length / 2), y + 2, nom.slice(0, largeur), melange(NOIR, couleurProjet(s.nom), 0.85));
    }

    // L'heure en gros, et l'état des sessions
    const heure = new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\s*h\s*/, ':');
    const caracteres = [...heure].filter((ch) => CHIFFRES[ch]);
    const largeurHeure = caracteres.length * 4;
    const yHeure = Math.min(hauteur - 5, zoneHaut + 1);
    const couleurHeure = melange(theme.primaire, theme.accent, (Math.sin(frame / 15) + 1) / 2);
    caracteres.forEach((ch, i) => {
        ecrire(Math.floor((largeur - largeurHeure) / 2) + i * 4, yHeure, CHIFFRES[ch][0], couleurHeure);
        ecrire(Math.floor((largeur - largeurHeure) / 2) + i * 4, yHeure + 1, CHIFFRES[ch][1], couleurHeure);
    });
    const travaillent = sessions.filter((s: any) => s.statut === 'travaille').length;
    const attendent = sessions.filter((s: any) => s.statut === 'bloquee' || s.statut === 'attend').length;
    const resume = sessions.length
        ? `${travaillent} au travail · ${attendent} t'attend${attendent > 1 ? 'ent' : ''}`
        : 'aucune session active';
    ecrire(Math.floor((largeur - resume.length) / 2), yHeure + 3, resume, fond.texte);
    const aide = 'une touche ou la souris pour revenir';
    ecrire(Math.floor((largeur - aide.length) / 2), yHeure + 4, aide, fond.discret);

    // Chaque ligne : des morceaux de même couleur
    return (
        <box width={largeur} height={hauteur} backgroundColor={NOIR} flexDirection="column" onMouseDown={reveiller} onMouseMove={reveiller}>
            {grille.map((ligne, y) => {
                const morceaux: Cellule[] = [];
                for (const c of ligne) {
                    const dernier = morceaux.at(-1);
                    if (dernier && (dernier.fg === c.fg || c.ch === ' ')) dernier.ch += c.ch;
                    else morceaux.push({ ...c });
                }
                return <text key={y}>{morceaux.map((m, i) => <span key={i} fg={m.fg} attributes={m.fg === fond.texte ? GRAS : 0}>{m.ch}</span>)}</text>;
            })}
        </box>
    );
}
