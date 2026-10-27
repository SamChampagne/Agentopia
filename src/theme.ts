import chalk from 'chalk';
import { chargerConfig } from './config.js';

const config = chargerConfig();
// Copie modifiable : le menu Configuration change le thème en direct (appliquerTheme)
export const theme = { ...config.theme };

export const c = {
    primaire: chalk.hex(theme.primaire),
    secondaire: chalk.hex(theme.secondaire),
    accent: chalk.hex(theme.accent),
    succes: chalk.hex('#4ade80'),
    alerte: chalk.hex('#facc15'),
    erreur: chalk.hex('#f87171'),
    discret: chalk.gray,
    violet: chalk.hex('#a78bfa'),
};

export const PALETTES: Record<string, typeof theme> = {
    'Océan': { primaire: '#00b4d8', secondaire: '#90e0ef', accent: '#f72585' },
    'Forêt': { primaire: '#4ade80', secondaire: '#a7f3d0', accent: '#facc15' },
    'Coucher de soleil': { primaire: '#fb923c', secondaire: '#fcd34d', accent: '#f472b6' },
    'Lavande': { primaire: '#a78bfa', secondaire: '#c4b5fd', accent: '#22d3ee' },
    'Sobre': { primaire: '#e2e8f0', secondaire: '#94a3b8', accent: '#38bdf8' },
};

export function appliquerTheme(nouveau: typeof theme): void {
    Object.assign(theme, nouveau);
    c.primaire = chalk.hex(theme.primaire);
    c.secondaire = chalk.hex(theme.secondaire);
    c.accent = chalk.hex(theme.accent);
}

export function nomPalette(): string {
    return Object.entries(PALETTES).find(([, p]) => p.primaire === theme.primaire && p.accent === theme.accent)?.[0] ?? 'personnalisé';
}

// Couleur stable par projet (même projet = même couleur d'onglet, partout)
const PALETTE = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#9b5de5', '#f15bb5', '#00bbf9', '#00f5d4', '#8ac926'];
export function couleurProjet(nom: string): string {
    const perso = config.couleurs[nom];
    if (perso) return perso;
    let h = 0;
    for (const ch of nom.toLowerCase().replace(/-.*$/, '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

function hexVersRgb(hex: string): number[] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Dégradé horizontal entre deux couleurs, caractère par caractère
export function degrade(texte: string, de = theme.primaire, a = theme.accent): string {
    const [r1, g1, b1] = hexVersRgb(de);
    const [r2, g2, b2] = hexVersRgb(a);
    const largeur = Math.max(...texte.split('\n').map((l) => l.length), 1);
    return texte.split('\n').map((ligne) => [...ligne].map((ch, i) => {
        const t = i / largeur;
        return chalk.rgb(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)(ch);
    }).join('')).join('\n');
}

// Jauge [██████░░░░] colorée selon le niveau
export function jauge(pourcent: number, largeur = 20): string {
    const plein = Math.round((Math.min(100, Math.max(0, pourcent)) / 100) * largeur);
    const couleur = pourcent > 85 ? c.erreur : pourcent > 60 ? c.alerte : c.succes;
    return `[${couleur('█'.repeat(plein))}${c.discret('░'.repeat(largeur - plein))}]`;
}

// Police "bloc" de 3 lignes pour la bannière
const POLICE: Record<string, string[]> = {
    A: ['▄▀█', '█▀█', '   '], B: ['█▄▄', '█▄█', '   '], C: ['█▀▀', '█▄▄', '   '], D: ['█▀▄', '█▄▀', '   '],
    E: ['█▀▀', '██▄', '   '], F: ['█▀▀', '█▀ ', '   '], G: ['█▀▀', '█▄█', '   '], H: ['█ █', '█▀█', '   '],
    I: ['█', '█', ' '], J: ['  █', '█▄█', '   '], K: ['█▄▀', '█ █', '   '], L: ['█  ', '█▄▄', '   '],
    M: ['█▀▄▀█', '█ ▀ █', '     '], N: ['█▄ █', '█ ▀█', '    '], O: ['█▀█', '█▄█', '   '], P: ['█▀█', '█▀▀', '   '],
    Q: ['█▀█', '▀▀█', '   '], R: ['█▀█', '█▀▄', '   '], S: ['█▀', '▄█', '  '], T: ['▀█▀', ' █ ', '   '],
    U: ['█ █', '█▄█', '   '], V: ['█ █', '▀▄▀', '   '], W: ['█ █ █', '▀▄▀▄▀', '     '], X: ['▀▄▀', '█ █', '   '],
    Y: ['█▄█', ' █ ', '   '], Z: ['▀█', '█▄', '  '], ' ': [' ', ' ', ' '], '-': ['   ', '▀▀▀', '   '],
};

export function banniere(texte = config.banniere): string {
    const lignes = ['', ''];
    for (const ch of texte.toUpperCase()) {
        const glyphe = POLICE[ch] ?? POLICE[' '];
        lignes[0] += glyphe[0] + ' ';
        lignes[1] += glyphe[1] + ' ';
    }
    return degrade(lignes.join('\n'));
}
