import { useEffect, useState } from 'react';
import { theme, melange } from '../dist/theme.js';
import { Dessin } from './toile.tsx';

// Logo 3D de l'accueil : un anneau (tore) qui tourne, ombré par la lumière, aux couleurs du thème.
// L'idée du célèbre « donut.c » : chaque point de la surface est tourné, projeté, et le plus proche gagne sa case.

const OMBRES = '.,-~:;=!*#$@';
const NOIR = '#0c0c0c';

export function Logo3D({ largeur, hauteur }: { largeur: number; hauteur: number }) {
    const [t, setT] = useState(0);
    useEffect(() => {
        const minuterie = setInterval(() => setT((x) => x + 1.4), 65);
        return () => clearInterval(minuterie);
    }, []);
    const A = 1 + t * 0.07, B = t * 0.035;
    const [cA, sA, cB, sB] = [Math.cos(A), Math.sin(A), Math.cos(B), Math.sin(B)];
    const profondeur = new Float32Array(largeur * hauteur);
    const lum = new Float32Array(largeur * hauteur).fill(-1);
    const R1 = 1, R2 = 2, K2 = 5;
    // K1 : la taille à l'écran (un caractère est deux fois plus haut que large)
    const K1 = Math.min(largeur * K2 * 3 / (8 * (R1 + R2)), hauteur * K2 * 3 / (4 * (R1 + R2)));
    for (let theta = 0; theta < 6.28; theta += 0.07) {
        const [ct, st] = [Math.cos(theta), Math.sin(theta)];
        for (let phi = 0; phi < 6.28; phi += 0.02) {
            const [cp, sp] = [Math.cos(phi), Math.sin(phi)];
            const cx = R2 + R1 * ct, cy = R1 * st;
            const x = cx * (cB * cp + sA * sB * sp) - cy * cA * sB;
            const y = cx * (sB * cp - sA * cB * sp) + cy * cA * cB;
            const z = K2 + cA * cx * sp + cy * sA;
            const unSurZ = 1 / z;
            const xp = Math.floor(largeur / 2 + K1 * unSurZ * x);
            const yp = Math.floor(hauteur / 2 - (K1 / 2) * unSurZ * y);
            if (xp < 0 || xp >= largeur || yp < 0 || yp >= hauteur) continue;
            const L = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
            const i = yp * largeur + xp;
            if (unSurZ > profondeur[i]) {
                profondeur[i] = unSurZ;
                lum[i] = L;
            }
        }
    }
    // Chaque ligne en morceaux de même couleur (6 teintes, du thème primaire à l'accent)
    const teintes = Array.from({ length: 6 }, (_, k) => melange(melange(NOIR, theme.primaire, 0.55), theme.accent, k / 5));
    const lignes = Array.from({ length: hauteur }, (_, y) => {
        const morceaux: { t: string; c?: string }[] = [];
        for (let x = 0; x < largeur; x++) {
            const L = lum[y * largeur + x];
            const ch = L < 0 ? (profondeur[y * largeur + x] ? '.' : ' ') : OMBRES[Math.min(11, Math.floor(L * 8))];
            const c = ch === ' ' ? undefined : teintes[Math.max(0, Math.min(5, Math.floor(Math.max(0, L) * 4.2)))];
            const dernier = morceaux.at(-1);
            if (dernier && (dernier.c === c || c === undefined)) dernier.t += ch;
            else morceaux.push({ t: ch, c });
        }
        return morceaux;
    });
    return <Dessin largeur={largeur} hauteur={hauteur} lignes={lignes} />;
}
