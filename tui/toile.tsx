import { RGBA, TextAttributes } from '@opentui/core';

// Toile en braille : chaque caractère contient 2 × 4 points (⣿), soit 8 fois la résolution du texte.
// On y dessine des points en coordonnées « pixel », puis on la rend ligne par ligne, en morceaux de même couleur.

const BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];

export class Toile {
    readonly largeurPx: number;
    readonly hauteurPx: number;
    private points: Uint8Array;
    private couleurs: string[];
    private priorites: Uint8Array;
    private textes: (string | undefined)[];

    constructor(readonly largeur: number, readonly hauteur: number) {
        this.largeurPx = largeur * 2;
        this.hauteurPx = hauteur * 4;
        this.points = new Uint8Array(largeur * hauteur);
        this.couleurs = new Array(largeur * hauteur);
        this.priorites = new Uint8Array(largeur * hauteur);
        this.textes = new Array(largeur * hauteur);
    }

    // Un point ; la couleur d'une case est celle du point le plus prioritaire (un serveur passe devant la grille)
    point(x: number, y: number, couleur: string, priorite = 0): void {
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || y < 0 || x >= this.largeurPx || y >= this.hauteurPx) return;
        const i = (y >> 2) * this.largeur + (x >> 1);
        this.points[i] |= BITS[y & 3][x & 1];
        if (priorite >= this.priorites[i]) {
            this.couleurs[i] = couleur;
            this.priorites[i] = priorite;
        }
    }

    // Du texte par-dessus (en cases, pas en pixels)
    texte(colonne: number, ligne: number, texte: string, couleur: string): void {
        if (ligne < 0 || ligne >= this.hauteur) return;
        [...texte].forEach((ch, k) => {
            const x = colonne + k;
            if (x < 0 || x >= this.largeur) return;
            const i = ligne * this.largeur + x;
            this.textes[i] = ch;
            this.couleurs[i] = couleur;
            this.priorites[i] = 255;
        });
    }

    // Chaque ligne : des morceaux { texte, couleur } (les cases vides rejoignent le morceau précédent)
    lignes(): { t: string; c?: string }[][] {
        const res: { t: string; c?: string }[][] = [];
        for (let y = 0; y < this.hauteur; y++) {
            const ligne: { t: string; c?: string }[] = [];
            for (let x = 0; x < this.largeur; x++) {
                const i = y * this.largeur + x;
                const ch = this.textes[i] ?? (this.points[i] ? String.fromCharCode(0x2800 + this.points[i]) : ' ');
                const c = ch === ' ' ? undefined : this.couleurs[i];
                const dernier = ligne.at(-1);
                if (dernier && (dernier.c === c || c === undefined)) dernier.t += ch;
                else if (dernier && dernier.t.trim() === '') {
                    dernier.t += ch;
                    dernier.c = c;
                } else ligne.push({ t: ch, c });
            }
            res.push(ligne);
        }
        return res;
    }
}

export type Morceaux = { t: string; c?: string; gras?: boolean }[][];

const rgba = new Map<string, RGBA>();
const versRgba = (hex: string) => {
    let c = rgba.get(hex);
    if (!c) rgba.set(hex, (c = RGBA.fromHex(hex)));
    return c;
};

// Dessine des lignes de morceaux colorés directement dans le tampon de l'écran, sans un élément React par morceau :
// une animation plein écran à 15-20 images/s reste légère (un élément React par morceau coûtait un cœur entier)
export function Dessin({ largeur, hauteur, lignes }: { largeur: number; hauteur: number; lignes: Morceaux }) {
    return (
        <box width={largeur} height={hauteur} flexShrink={0}
            renderAfter={function (this: any, tampon: any) {
                lignes.forEach((ligne, y) => {
                    let x = 0;
                    for (const m of ligne) {
                        if (m.c && m.t.trim()) tampon.drawText(m.t, this.x + x, this.y + y, versRgba(m.c), undefined, m.gras ? TextAttributes.BOLD : 0);
                        x += m.t.length;
                    }
                });
            }} />
    );
}

export function RenduToile({ toile }: { toile: Toile }) {
    return <Dessin largeur={toile.largeur} hauteur={toile.hauteur} lignes={toile.lignes()} />;
}
