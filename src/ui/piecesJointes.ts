import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Brouillon } from './brouillons.js';

export function verifierPiecesJointes(images: readonly string[]): void {
    for (const fichier of images) {
        try {
            if (!fs.statSync(fichier).isFile()) throw new Error('Pas un fichier');
            fs.accessSync(fichier, fs.constants.R_OK);
        } catch {
            throw new Error(`Pièce jointe inaccessible : ${path.basename(fichier)} · Alt+I pour la retirer ou la remplacer.`);
        }
    }
}

export function retirerPiecesJointes(brouillon: Brouillon, indices: readonly number[]): Brouillon {
    const retires = new Set(indices);
    const numeros = new Map<number, number>();
    const images = brouillon.images.filter((_, i) => {
        if (retires.has(i)) return false;
        numeros.set(i + 1, numeros.size + 1);
        return true;
    });
    const texte = brouillon.texte.replace(/\[(image|fichier) (\d+)(:[^\]\r\n]*)?\]/g, (jeton, type, numero, nom = '') => {
        const ancien = Number(numero);
        if (ancien < 1 || ancien > brouillon.images.length) return jeton;
        const nouveau = numeros.get(ancien);
        return nouveau ? `[${type} ${nouveau}${nom}]` : '';
    });
    return { texte, images };
}
