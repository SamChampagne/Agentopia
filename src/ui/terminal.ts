import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import { TRACE, tracer } from './sortie.js';

// Souris dans le terminal : on active le suivi xterm (mode SGR) et on filtre les séquences
// avant qu'Ink ne les voie, sinon elles seraient tapées dans la saisie.

export interface Souris {
    x: number;              // colonne, à partir de 0
    y: number;              // ligne, à partir de 0
    bouton: 'gauche' | 'milieu' | 'droit' | 'molette-haut' | 'molette-bas';
    appui: boolean;         // false = relâchement
    glisse?: boolean;       // mouvement avec le bouton enfoncé
    crans?: number;         // molette : plusieurs crans regroupés en un seul événement
}

export const souris = new EventEmitter();

// Faux stdin pour Ink : reçoit tout sauf les séquences souris
class Entree extends PassThrough {
    isTTY = true;
    setRawMode(mode: boolean) {
        process.stdin.setRawMode?.(mode);
        return this;
    }
    // ref/unref n'existent que si stdin est un vrai terminal (pas un tube)
    ref() {
        (process.stdin as { ref?: () => void }).ref?.();
        return this;
    }
    unref() {
        (process.stdin as { unref?: () => void }).unref?.();
        return this;
    }
}

export const entree = new Entree();

const SEQUENCE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;

// Une molette rapide envoie des dizaines de crans par seconde : on les regroupe par tranche de 16 ms
// (un seul rendu qui défile de la somme), de même pour les mouvements quand on glisse
let molette: Souris | undefined;
let glisse: Souris | undefined;
let minuterie: NodeJS.Timeout | undefined;
function vider(): void {
    clearTimeout(minuterie);
    minuterie = undefined;
    if (molette) souris.emit('souris', molette);
    if (glisse) souris.emit('souris', glisse);
    molette = glisse = undefined;
}
function plusTard(): void {
    minuterie ??= setTimeout(vider, 16);
}

// Exporté pour les tests de réactivité : comme si le terminal envoyait ces octets
export function injecter(d: Buffer | string): void {
    surDonnees(Buffer.from(d));
}

function surDonnees(d: Buffer) {
    const texte = d.toString('utf-8').replace(SEQUENCE, (_, b, x, y, type) => {
        const code = Number(b);
        // Mouvement (bit 32) : on ne garde que ceux faits bouton enfoncé (pour glisser la séparation)
        if (code & 32) {
            if ((code & 3) === 3) return '';
            glisse = { x: Number(x) - 1, y: Number(y) - 1, bouton: 'gauche', appui: true, glisse: true };
            plusTard();
            return '';
        }
        const bouton = code & 64 ? (code & 1 ? 'molette-bas' : 'molette-haut') : (['gauche', 'milieu', 'droit'] as const)[code & 3] ?? 'gauche';
        const e: Souris = { x: Number(x) - 1, y: Number(y) - 1, bouton, appui: type === 'M' };
        if (TRACE) tracer(JSON.stringify({ t: Date.now(), souris: e }));
        if (bouton === 'molette-haut' || bouton === 'molette-bas') {
            const sens = bouton === 'molette-haut' ? 1 : -1;
            const net = (molette ? (molette.bouton === 'molette-haut' ? 1 : -1) * (molette.crans ?? 1) : 0) + sens;
            molette = net ? { ...e, bouton: net > 0 ? 'molette-haut' : 'molette-bas', crans: Math.abs(net) } : undefined;
            plusTard();
            return '';
        }
        // Un clic passe après les crans et mouvements en attente (l'ordre est gardé)
        vider();
        souris.emit('souris', e);
        return '';
    });
    if (texte) entree.write(texte);
}

const ECRAN_ALT = '\x1b[?1049h', ECRAN_NORMAL = '\x1b[?1049l';
// 1002 = clics + mouvements bouton enfoncé ; 1006 = coordonnées au format SGR
const SOURIS_ON = '\x1b[?1002h\x1b[?1006h', SOURIS_OFF = '\x1b[?1002l\x1b[?1000l\x1b[?1006l';

export function activer(): void {
    process.stdout.write(ECRAN_ALT + SOURIS_ON);
    process.stdin.on('data', surDonnees);
    process.stdin.resume();
}

export function desactiver(): void {
    process.stdin.off('data', surDonnees);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.stdout.write(SOURIS_OFF + '\x1b[?25h' + ECRAN_NORMAL);
}
