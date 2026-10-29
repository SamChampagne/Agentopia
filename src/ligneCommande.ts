// Arguments du CLI, pas du shell : les antislashs Windows restent littéraux.
export interface Argument { valeur: string; fin: number }
export function lireArgument(texte: string, debut = 0): Argument | undefined {
    let i = debut;
    while (/\s/.test(texte[i] ?? '') && i < texte.length) i++;
    if (i === texte.length) return;
    const quote = ['"', "'"].includes(texte[i]) ? texte[i++] : undefined;
    let valeur = '';
    if (quote) {
        while (i < texte.length) {
            if (texte[i] === quote) {
                if (texte[i + 1] === quote) { valeur += quote; i += 2; continue; }
                i++;
                if (i < texte.length && !/\s/.test(texte[i])) throw new Error('Ajoute un espace après le guillemet fermant.');
                return { valeur, fin: i };
            }
            valeur += texte[i++];
        }
        throw new Error('Guillemet non fermé : entoure le chemin complet de guillemets.');
    }
    while (i < texte.length && !/\s/.test(texte[i])) valeur += texte[i++];
    return { valeur, fin: i };
}
export function argumentsCommande(texte: string): string[] {
    const args: string[] = [];
    let a: Argument | undefined, fin = 0;
    while ((a = lireArgument(texte, fin))) { args.push(a.valeur); fin = a.fin; }
    return args;
}
export const citerArgument = (texte: string): string => `"${texte.replace(/"/g, '""')}"`;

export function suggestionsCommande(inconnue: string, noms: string[]): string[] {
    const mot = inconnue.replace(/^\//, '').toLowerCase();
    const distance = (b: string) => {
        let ligne = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 0; i < mot.length; i++) {
            const suivante = [i + 1];
            for (let j = 0; j < b.length; j++) suivante[j + 1] = Math.min(suivante[j] + 1, ligne[j + 1] + 1, ligne[j] + Number(mot[i] !== b[j]));
            ligne = suivante;
        }
        return ligne[b.length];
    };
    return [...new Set(noms)].map((nom) => ({ nom, score: distance(nom) }))
        .filter((r) => r.score <= Math.max(1, Math.min(3, Math.floor(mot.length / 2)))).sort((a, b) => a.score - b.score || a.nom.localeCompare(b.nom))
        .slice(0, 3).map((r) => `/${r.nom}`);
}
