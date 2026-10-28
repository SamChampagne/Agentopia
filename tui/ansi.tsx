import { TextAttributes } from '@opentui/core';

// OpenTUI ne lit pas les codes couleur dans le texte : on convertit les chaînes faites avec chalk
// (cockpit, dégradés, jauges…) en morceaux <span fg bg attributes>. Le style reste celui d'aujourd'hui.

export interface Morceau { t: string; fg?: string; bg?: string; attributs: number }

const BASE = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5'];
const VIVE = ['#808080', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'];
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
function couleur256(n: number): string {
    if (n < 8) return BASE[n];
    if (n < 16) return VIVE[n - 8];
    if (n < 232) {
        const v = [0, 95, 135, 175, 215, 255];
        const i = n - 16;
        return hex(v[Math.floor(i / 36)], v[Math.floor(i / 6) % 6], v[i % 6]);
    }
    const g = 8 + (n - 232) * 10;
    return hex(g, g, g);
}

const connus = new Map<string, Morceau[]>();

export function morceauxAnsi(texte: string): Morceau[] {
    const deja = connus.get(texte);
    if (deja) return deja;
    const res: Morceau[] = [];
    let fg: string | undefined, bg: string | undefined, attributs = 0;
    const re = /\x1b\[([0-9;]*)m/g;
    let dernier = 0;
    const pousser = (t: string) => {
        if (!t) return;
        const p = res.at(-1);
        if (p && p.fg === fg && p.bg === bg && p.attributs === attributs) p.t += t;
        else res.push({ t, fg, bg, attributs });
    };
    for (let m = re.exec(texte); m; m = re.exec(texte)) {
        pousser(texte.slice(dernier, m.index));
        dernier = re.lastIndex;
        const codes = (m[1] || '0').split(';').map(Number);
        for (let i = 0; i < codes.length; i++) {
            const c = codes[i];
            if (c === 0) { fg = bg = undefined; attributs = 0; }
            else if (c === 1) attributs |= TextAttributes.BOLD;
            else if (c === 2) attributs |= TextAttributes.DIM;
            else if (c === 3) attributs |= TextAttributes.ITALIC;
            else if (c === 4) attributs |= TextAttributes.UNDERLINE;
            else if (c === 7) attributs |= TextAttributes.INVERSE;
            else if (c === 22) attributs &= ~(TextAttributes.BOLD | TextAttributes.DIM);
            else if (c === 23) attributs &= ~TextAttributes.ITALIC;
            else if (c === 24) attributs &= ~TextAttributes.UNDERLINE;
            else if (c === 27) attributs &= ~TextAttributes.INVERSE;
            else if (c >= 30 && c <= 37) fg = BASE[c - 30];
            else if (c >= 90 && c <= 97) fg = VIVE[c - 90];
            else if (c >= 40 && c <= 47) bg = BASE[c - 40];
            else if (c >= 100 && c <= 107) bg = VIVE[c - 100];
            else if (c === 39) fg = undefined;
            else if (c === 49) bg = undefined;
            else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
                const h = hex(codes[i + 2], codes[i + 3], codes[i + 4]);
                if (c === 38) fg = h; else bg = h;
                i += 4;
            } else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
                const h = couleur256(codes[i + 2]);
                if (c === 38) fg = h; else bg = h;
                i += 2;
            }
        }
    }
    pousser(texte.slice(dernier));
    if (connus.size > 3000) connus.clear();
    connus.set(texte, res);
    return res;
}

// Une ligne colorée par chalk, telle quelle, dans un <text>
export function Ansi({ texte, fg }: { texte: string; fg?: string }) {
    return (
        <text fg={fg} wrapMode="none">
            {morceauxAnsi(texte).map((m, i) => <span key={i} fg={m.fg} bg={m.bg} attributes={m.attributs}>{m.t}</span>)}
        </text>
    );
}
