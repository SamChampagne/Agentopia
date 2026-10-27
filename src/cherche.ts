import * as path from 'path';
import { spawn } from 'child_process';
import { Projet, estWorktree } from './projets.js';
import { choisir, tache } from './ui/bus.js';
import { lancerDetache } from './lanceurs.js';
import { c } from './theme.js';
import { puce } from './dashboard.js';

const MAX_RESULTATS = 300;
const EXCLUS = ['node_modules', 'dist', 'build', '.next', 'vendor', 'bin', 'obj', '.claude', '*.min.*', '*.map', 'package-lock.json', '*.lock'];

interface Resultat {
    projet: Projet;
    fichier: string;
    ligne: number;
    texte: string;
}

function rg(motif: string, dossiers: string[]): Promise<string[]> {
    return new Promise((ok, ko) => {
        const args = ['-n', '--no-heading', '--color', 'never', '-S', '--max-count', '5', '-M', '200',
            ...EXCLUS.flatMap((e) => ['-g', `!${e}`]), '--', motif, ...dossiers];
        const proc = spawn('rg', args);
        let tampon = '';
        const lignes: string[] = [];
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (d: string) => {
            tampon += d;
            const morceaux = tampon.split(/\r?\n/);
            tampon = morceaux.pop()!;
            lignes.push(...morceaux);
            if (lignes.length >= MAX_RESULTATS) proc.kill();
        });
        proc.on('error', () => ko(new Error('ripgrep (rg) introuvable : winget install BurntSushi.ripgrep.MSVC')));
        proc.on('close', () => ok(lignes.slice(0, MAX_RESULTATS)));
    });
}

function surligner(texte: string, motif: string): string {
    const echappe = motif.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sensible = /[A-Z]/.test(motif);   // comme rg -S : sensible à la casse seulement s'il y a une majuscule
    return texte.replace(new RegExp(echappe, sensible ? 'g' : 'gi'), (m) => c.accent.bold(m));
}

// Recherche dans le code de tous les projets (worktrees exclus : même code que le dépôt principal)
export async function cherche(projets: Projet[], motif: string): Promise<void> {
    const cibles = projets.filter((p) => !estWorktree(p.chemin));
    const brut = await tache(`Recherche de « ${motif} » dans ${cibles.length} projets`, () => rg(motif, cibles.map((p) => p.chemin)));
    const resultats: Resultat[] = [];
    for (const l of brut) {
        const m = /^(.*?):(\d+):(.*)$/.exec(l);
        if (!m) continue;
        const projet = cibles
            .filter((p) => m[1].toLowerCase().startsWith(p.chemin.toLowerCase() + path.sep))
            .sort((a, b) => b.chemin.length - a.chemin.length)[0];
        if (projet) resultats.push({ projet, fichier: m[1], ligne: Number(m[2]), texte: m[3].trim() });
    }
    if (!resultats.length) {
        console.log(c.discret(`Aucun résultat pour « ${motif} ».`));
        return;
    }

    const parProjet = new Map<Projet, Resultat[]>();
    resultats.forEach((r) => parProjet.set(r.projet, [...(parProjet.get(r.projet) ?? []), r]));
    const plafond = resultats.length >= MAX_RESULTATS ? c.alerte(` (limité à ${MAX_RESULTATS})`) : '';
    console.log(c.discret(`${resultats.length} résultats dans ${parProjet.size} projets`) + plafond);
    for (const [projet, liste] of parProjet) {
        console.log(`\n  ${puce(projet.nom)} ${projet.nom} ${c.discret(`(${liste.length})`)}`);
        for (const r of liste.slice(0, 8)) {
            const relatif = path.relative(projet.chemin, r.fichier);
            console.log(`    ${c.secondaire(`${relatif}:${r.ligne}`)}  ${surligner(r.texte.slice(0, 110), motif)}`);
        }
        if (liste.length > 8) console.log(c.discret(`    … et ${liste.length - 8} autres`));
    }
    console.log();

    const choix = await choisir('Ouvrir dans VS Code (Échap pour fermer)', resultats.map((r) => ({
        label: `${r.projet.nom} · ${path.relative(r.projet.chemin, r.fichier)}:${r.ligne}`,
        valeur: r,
        description: r.texte.slice(0, 80),
    })), true);
    lancerDetache('code', ['-g', `${choix.fichier}:${choix.ligne}`]);
}
