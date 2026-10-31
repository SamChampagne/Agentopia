import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { ligneMarkdown } from './affichage.js';
import { c } from './theme.js';
import type { Message } from './agents.js';

export const textePropre = (s: string) => s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
export function commandeLisible(commande: string): string {
    const c = textePropre(commande).trim();
    // Le détail conserve toujours la commande exacte, y compris les enveloppes.
    const ps = c.match(/^(?:"[^"\n]*(?:powershell|pwsh)(?:\.exe)"|(?:powershell|pwsh)(?:\.exe)?)(?: -NoProfile)? -Command (["'])([\s\S]*)\1$/i);
    return ps ? ps[2] : c;
}
export function titreOutil(m: Message): string {
    if (!m.commande) return m.fichier ? `${m.texte} · ${m.fichier.replace(/.*[/\\]/, '')}` : m.texte;
    const cmd = commandeLisible(m.commande);
    if (/^(Get-Content|cat|type)\s/i.test(cmd)) return `Lire · ${cmd.replace(/^(Get-Content|cat|type)\s+/i, '')}`;
    if (/^(rg|grep)\s/i.test(cmd)) return `Rechercher · ${cmd.replace(/^(rg|grep)\s+/i, '')}`;
    return cmd;
}
export function lignesOutil(m: Message, largeur: number, details: boolean): string[] {
    const largeurTexte = Math.max(16, largeur - 3);
    const etat = m.etat === 'en_cours' ? 'en cours' : m.etat === 'erreur' ? `échec${m.codeSortie !== undefined ? ` · code ${m.codeSortie}` : ''}` : m.etat === 'interrompu' ? 'interrompu' : m.etat ? 'terminé' : '';
    const icone = m.etat === 'en_cours' ? '→' : m.etat === 'erreur' ? '✗' : m.etat === 'interrompu' ? '■' : m.etat ? '✓' : '▸';
    const titre = wrapAnsi(textePropre(titreOutil(m)), largeurTexte, { hard: true }).split('\n');
    const couleur = m.etat === 'erreur' ? c.erreur : m.etat === 'en_cours' ? c.accent : c.secondaire;
    const lignes = [couleur(`${icone} ${titre[0]}${titre.length > 1 && !details ? '…' : ''}`)];
    if (details) lignes.push(...titre.slice(1).map((l) => `  ${l}`));
    if (etat) lignes.push(c.discret(`  ${etat}${m.dureeMs !== undefined ? ` · ${(m.dureeMs / 1000).toFixed(1)} s` : ''}`));
    if (details && m.commande) lignes.push(...wrapAnsi(`Commande exacte : ${textePropre(m.commande)}`, largeurTexte, { hard: true }).split('\n').map((l) => c.discret(`  ${l}`)));
    if (m.sortie) {
        const sortie = textePropre(m.sortie).trimEnd().split(/\r?\n/);
        const visibles = details ? sortie : sortie.slice(-3);
        if (m.sortieTronquee) lignes.push(c.discret('  Sortie volumineuse : les 128 000 derniers caractères sont conservés.'));
        if (!details && sortie.length > 3) lignes.push(c.discret(`  … ${sortie.length - 3} lignes précédentes · Détails des outils pour les afficher`));
        lignes.push(...visibles.flatMap((l) => wrapAnsi(l || ' ', largeurTexte, { hard: true }).split('\n').map((v) => c.discret(`  ${v}`))));
    }
    return lignes;
}
const cellules = (s: string) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((v) => v.trim().replace(/\\\|/g, '|'));
export function markdownConversation(texte: string, largeur: number): string[] {
    const lignes = textePropre(texte).split('\n'), resultat: string[] = [];
    let code = false;
    for (let i = 0; i < lignes.length; i++) {
        if (/^\s*```/.test(lignes[i])) { code = !code; resultat.push(c.discret(code ? `Code ${lignes[i].trim().slice(3)}`.trim() : '')); continue; }
        if (!code && lignes[i].includes('|') && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lignes[i + 1] || '')) {
            const entetes = cellules(lignes[i]), donnees: string[][] = []; i++;
            while (i + 1 < lignes.length && lignes[i + 1].includes('|') && lignes[i + 1].trim()) donnees.push(cellules(lignes[++i]));
            const n = entetes.length, espace = 3 * (n - 1), disponible = Math.max(n, largeur - espace - 1);
            if (n > 4 || disponible / n < 16) {
                for (const ligne of donnees) { for (let j = 0; j < n; j++) resultat.push(ligneMarkdown(`${entetes[j]} : ${ligne[j] || ''}`)); resultat.push(''); }
            } else {
                const largeurs = entetes.map((h, j) => Math.min(Math.floor(disponible / n), Math.max(stringWidth(h), ...donnees.map((l) => stringWidth(l[j] || '')))));
                largeurs[n - 1] += disponible - largeurs.reduce((a, b) => a + b, 0);
                const ranger = (r: string[]) => {
                    const cases = entetes.map((_, j) => wrapAnsi(ligneMarkdown(r[j] || ''), largeurs[j], { hard: true }).split('\n'));
                    for (let k = 0; k < Math.max(...cases.map((x) => x.length)); k++) resultat.push(cases.map((x, j) => (x[k] || '') + ' '.repeat(Math.max(0, largeurs[j] - stringWidth(x[k] || '')))).join(c.discret(' │ ')));
                };
                ranger(entetes); resultat.push(c.discret(largeurs.map((l) => '─'.repeat(l)).join('─┼─'))); donnees.forEach(ranger);
            }
        } else resultat.push(code ? `  ${lignes[i]}` : ligneMarkdown(lignes[i]));
    }
    return resultat.flatMap((l) => wrapAnsi(l, Math.max(1, largeur), { hard: true, trim: false }).split('\n'));
}
