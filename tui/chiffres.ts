// Grands chiffres lisibles : une police de 3 × 5 pixels (la forme classique des afficheurs),
// dessinée en demi-blocs (▀ ▄ █) sur 3 lignes de texte. Sert aux tuiles de la vue Live et à l'horloge de la veille.

const POLICE: Record<string, string[]> = {
    0: ['###', '#.#', '#.#', '#.#', '###'],
    1: ['.#.', '##.', '.#.', '.#.', '###'],
    2: ['###', '..#', '###', '#..', '###'],
    3: ['###', '..#', '.##', '..#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'],
    5: ['###', '#..', '###', '..#', '###'],
    6: ['###', '#..', '###', '#.#', '###'],
    7: ['###', '..#', '.#.', '.#.', '.#.'],
    8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '###'],
    ':': ['.', '#', '.', '#', '.'],
    ',': ['.', '.', '.', '#', '#'],
    '/': ['..#', '..#', '.#.', '#..', '#..'],
    ' ': ['.', '.', '.', '.', '.'],
};

// Deux rangées de pixels par ligne de texte : haut et bas → ' ', '▀', '▄' ou '█'
function demiBloc(haut: boolean, bas: boolean): string {
    return haut ? (bas ? '█' : '▀') : bas ? '▄' : ' ';
}

export function grandsChiffres(texte: string): [string, string, string] {
    const lignes: [string, string, string] = ['', '', ''];
    [...texte].filter((ch) => POLICE[ch]).forEach((ch, n) => {
        const g = POLICE[ch];
        const espace = n ? ' ' : '';
        for (let l = 0; l < 3; l++) {
            const haut = g[l * 2], bas = g[l * 2 + 1];
            lignes[l] += espace + [...haut].map((p, i) => demiBloc(p === '#', bas?.[i] === '#')).join('');
        }
    });
    return lignes;
}
