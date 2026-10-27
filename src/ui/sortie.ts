import * as fs from 'fs';
import { CHEMINS } from '../chemins.js';

// Sortie pour Ink en plein écran : rapide et sans scintillement.
// Ink réécrit toute l'image à chaque changement (jusqu'à 30 fois par seconde) : en plein écran,
// c'est des dizaines de Ko par image et le terminal prend du retard (défilement qui « bugue »).
// Ici on compare avec l'image précédente et on n'écrit que les lignes qui ont changé.
// Si le terminal n'a pas fini d'afficher l'image précédente, on ne garde que la plus récente :
// les images intermédiaires sont sautées au lieu de s'empiler.

const EFFACEMENT = /^(?:\x1b\[2K(?:\x1b\[1A)?)+\x1b\[G/;
// Effacement complet qu'Ink envoie quand l'image atteint la hauteur du terminal
const EFFACEMENT_TOTAL = /\x1b\[2J|\x1b\[3J|\x1b\[0?f|\x1bc/g;
// Pour comparer avec l'ancien comportement (image entière à chaque fois)
const SANS_DIFF = !!process.env.CLAUDETOPIA_SANS_DIFF;

// Diagnostic : si ~/.claudetopia-trace existe, tout ce qui est écrit à l'écran y est ajouté
// Elle s'arrête d'elle-même à 20 Mo : oubliée, elle ralentirait tout et remplirait le disque
const FICHIER_TRACE = CHEMINS.trace;
const TRACE_MAX = 20_000_000;
let tailleTrace = 0;
try {
    tailleTrace = fs.statSync(FICHIER_TRACE).size;
} catch {
    // pas de trace demandée
}
export const TRACE = fs.existsSync(FICHIER_TRACE) && tailleTrace < TRACE_MAX ? FICHIER_TRACE : undefined;
export function tracer(ligne: string): void {
    if (!TRACE || tailleTrace >= TRACE_MAX) return;
    tailleTrace += ligne.length + 1;
    fs.appendFileSync(TRACE, ligne + '\n');
}

const invalidations = new Set<() => void>();
// Un autre programme a écrit sur l'écran (claude attach, ssh…) : la prochaine image est réécrite en entier
export function invaliderEcran(): void {
    invalidations.forEach((f) => f());
}

// Même objet que le flux (colonnes, lignes, événement resize…), sauf write
export function sortieVers(flux: NodeJS.WriteStream): NodeJS.WriteStream {
    let precedentes: string[] = [];
    let taille = '';
    let enAttente: string | undefined;     // image la plus récente, si le terminal est occupé
    let occupe = false;
    invalidations.add(() => (precedentes = []));

    const brut = (texte: string) => (flux.write as (t: string) => boolean).call(flux, texte);

    function ecrireImage(image: string): void {
        // Terminal redimensionné : tout est à refaire
        const t = `${flux.columns}x${flux.rows}`;
        if (t !== taille) {
            taille = t;
            precedentes = [];
        }
        const lignes = image.split('\n');
        let texte = '';
        if (SANS_DIFF || !precedentes.length) {
            texte = '\x1b[H' + lignes.map((l) => l + '\x1b[K').join('\n') + '\x1b[J';
        } else {
            for (let i = 0; i < lignes.length; i++) {
                if (lignes[i] !== precedentes[i]) texte += `\x1b[${i + 1};1H\x1b[0m${lignes[i]}\x1b[K`;
            }
            if (lignes.length < precedentes.length) texte += `\x1b[${lignes.length + 1};1H\x1b[0m\x1b[J`;
        }
        precedentes = lignes;
        if (!texte) return;
        if (TRACE) tracer(JSON.stringify({ t: Date.now(), cols: flux.columns, rows: flux.rows, texte }));
        if (!brut(texte)) {
            occupe = true;
            flux.once('drain', () => {
                occupe = false;
                const suivante = enAttente;
                enAttente = undefined;
                if (suivante !== undefined) ecrireImage(suivante);
            });
        }
    }

    function ecrire(donnees: string | Uint8Array, ...reste: unknown[]): boolean {
        const texte = typeof donnees === 'string' ? donnees : Buffer.from(donnees).toString('utf-8');
        if (!EFFACEMENT.test(texte) && !texte.includes('\n')) {
            if (TRACE) tracer(JSON.stringify({ t: Date.now(), texte }));
            return (flux.write as (t: string, ...r: unknown[]) => boolean).call(flux, texte, ...reste);
        }
        const image = texte.replace(EFFACEMENT, '').replace(EFFACEMENT_TOTAL, '').replace(/\n$/, '');
        if (occupe) enAttente = image;
        else ecrireImage(image);
        return true;
    }

    return new Proxy(flux, {
        get(cible, prop) {
            if (prop === 'write') return ecrire;
            const valeur = Reflect.get(cible, prop, cible);
            return typeof valeur === 'function' ? valeur.bind(cible) : valeur;
        },
    }) as NodeJS.WriteStream;
}

export const sortie = sortieVers(process.stdout);
