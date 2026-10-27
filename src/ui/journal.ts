import { EventEmitter } from 'events';
import { format } from 'util';

// Tout ce que les commandes écrivent (console.log) atterrit ici ; la zone principale l'affiche
// avec défilement. Gardé hors de React pour survivre aux remontages (après claude attach).

const MAX = 5000;
const lignes: string[] = [];
export const journal = new EventEmitter();

// Une commande qui écrit 500 lignes d'un coup ne redessine l'écran qu'une fois
let prevenu = false;
function prevenir(): void {
    if (prevenu) return;
    prevenu = true;
    setImmediate(() => {
        prevenu = false;
        if (lignes.length > MAX) lignes.splice(0, lignes.length - MAX);
        journal.emit('maj');
    });
}

export function ecrire(texte: string): void {
    for (const l of texte.split('\n')) lignes.push(l);
    prevenir();
}

export function lignesJournal(): string[] {
    return lignes;
}

export function vider(): void {
    lignes.length = 0;
    prevenir();
}

// Redirige console.log / console.error vers le journal (Ink plein écran ne doit rien recevoir d'autre)
export function capturerConsole(): void {
    console.log = (...args: unknown[]) => ecrire(format(...args));
    console.error = (...args: unknown[]) => ecrire(format(...args));
}

// Préfixe "⎿" sous la commande, comme Claude Code
export function avecRetrait<T>(fn: () => Promise<T>): Promise<T> {
    const original = console.log;
    let premier = true;
    console.log = (...args: unknown[]) => {
        const texte = format(...args);
        original(texte.split('\n').map((l) => {
            if (premier && !l.trim()) return '';
            const prefixe = premier ? '\x1b[90m  ⎿  \x1b[39m' : '     ';
            premier = false;
            return prefixe + l;
        }).join('\n'));
    };
    return fn().finally(() => {
        console.log = original;
    });
}
