import { c } from './theme.js';

// Retire les codes couleur pour mesurer la largeur réelle d'un texte
export const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

export function largeurVisible(s: string): number {
    // Les emojis "couleur" (🤖 💰…) prennent 2 colonnes ; les symboles comme ✓ ✻ ● une seule
    return [...visible(s)].reduce((n, ch) => n + (ch.codePointAt(0)! >= 0x1f000 ? 2 : 1), 0);
}

export function ajuster(s: string, largeur: number): string {
    const l = largeurVisible(s);
    if (l <= largeur) return s + ' '.repeat(largeur - l);
    const brut = visible(s);
    return brut.slice(0, Math.max(0, largeur - 1)) + '…';
}

// Titre de section : "── Projets récents ─────"
export function titre(texte: string, compte?: number): string {
    const libelle = compte === undefined ? texte : `${texte} ${c.discret(`(${compte})`)}`;
    return `\n${c.primaire.bold(libelle)}`;
}

export interface OptionsTableau {
    entetes?: string[];
    max?: number[];          // largeur max par colonne
    droite?: number[];       // colonnes alignées à droite
    retrait?: number;
}

// Tableau aligné : calcule la largeur des colonnes sur le contenu visible
export function tableau(lignes: string[][], options: OptionsTableau = {}): string {
    const { entetes, max = [], droite = [], retrait = 2 } = options;
    const toutes = entetes ? [entetes, ...lignes] : lignes;
    const nbCol = Math.max(...toutes.map((l) => l.length), 0);
    const largeurs = Array.from({ length: nbCol }, (_, i) =>
        Math.min(max[i] ?? 60, Math.max(...toutes.map((l) => largeurVisible(l[i] ?? '')))));
    const formater = (ligne: string[]) => ' '.repeat(retrait) + ligne.map((cell, i) => {
        const v = cell ?? '';
        if (i === ligne.length - 1 && !droite.includes(i)) return largeurVisible(v) > largeurs[i] ? ajuster(v, largeurs[i]) : v;
        if (droite.includes(i)) return ' '.repeat(Math.max(0, largeurs[i] - largeurVisible(v))) + v;
        return ajuster(v, largeurs[i]);
    }).join('  ');
    const sortie = lignes.map(formater);
    if (entetes) sortie.unshift(c.discret(visible(formater(entetes))));
    return sortie.join('\n');
}

// Un peu de couleur sur le markdown renvoyé par Claude (titres, puces, gras, code)
export function ligneMarkdown(ligne: string): string {
    const gras = (s: string) => s.replace(/\*\*(.+?)\*\*/g, (_, t) => c.secondaire.bold(t)).replace(/`([^`]+)`/g, (_, t) => c.accent(t));
    if (/^#{1,4} /.test(ligne)) return c.primaire.bold(ligne.replace(/^#+ /, ''));
    if (/^\s*[-*] /.test(ligne)) return gras(ligne.replace(/^(\s*)[-*] /, `$1${c.accent('•')} `));
    return gras(ligne);
}

// Boîte à coins arrondis, comme l'accueil de Claude Code
export function boite(lignesBrutes: string[], couleur = c.primaire, largeurMin = 0): string {
    // Coupe les lignes trop longues pour que la boîte tienne dans le terminal
    const largeurMax = Math.max(40, (process.stdout.columns || 100) - 12);
    const lignes = lignesBrutes.flatMap((l) => {
        if (largeurVisible(l) <= largeurMax) return [l];
        const morceaux: string[] = [];
        let courant = '';
        for (const mot of visible(l).split(' ')) {
            if (courant && largeurVisible(courant + ' ' + mot) > largeurMax) {
                morceaux.push(courant);
                courant = mot;
            } else {
                courant = courant ? `${courant} ${mot}` : mot;
            }
        }
        return [...morceaux, courant];
    });
    const largeur = Math.max(largeurMin, ...lignes.map(largeurVisible));
    const haut = couleur(`╭${'─'.repeat(largeur + 2)}╮`);
    const bas = couleur(`╰${'─'.repeat(largeur + 2)}╯`);
    const milieu = lignes.map((l) => `${couleur('│')} ${l}${' '.repeat(largeur - largeurVisible(l))} ${couleur('│')}`);
    return [haut, ...milieu, bas].join('\n');
}
