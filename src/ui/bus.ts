import { EventEmitter } from 'events';
import type { ReactNode } from 'react';

// Pont entre les commandes (code async normal) et l'interface Ink :
// une commande "demande" un choix, l'interface l'affiche et résout la promesse.

export interface Choix<T> {
    label: string;
    valeur: T;
    description?: string;
    coche?: boolean;
}

export type Demande =
    | { type: 'choix'; message: string; choix: Choix<unknown>[]; recherche: boolean; multiple: boolean; resoudre: (v: unknown) => void }
    | { type: 'saisie'; message: string; defaut: string; masque?: boolean; resoudre: (v: string | undefined) => void }
    | { type: 'vue'; rendu: (fermer: () => void) => ReactNode; resoudre: () => void };

export class Annule extends Error {
    name = 'Annule';
}

export const bus = new EventEmitter();

function demander<T>(construire: (resoudre: (v: T | undefined) => void) => Demande): Promise<T> {
    return new Promise((ok, ko) => {
        bus.emit('demande', construire((v) => {
            bus.emit('demande', undefined);
            if (v === undefined) ko(new Annule());
            else ok(v);
        }));
    });
}

export function choisir<T>(message: string, choix: Choix<T>[], recherche = choix.length > 8): Promise<T> {
    return demander<T>((resoudre) => ({
        type: 'choix', message, choix: choix as Choix<unknown>[], recherche, multiple: false,
        resoudre: resoudre as (v: unknown) => void,
    }));
}

export function choisirPlusieurs<T>(message: string, choix: Choix<T>[]): Promise<T[]> {
    return demander<T[]>((resoudre) => ({
        type: 'choix', message, choix: choix as Choix<unknown>[], recherche: false, multiple: true,
        resoudre: resoudre as (v: unknown) => void,
    }));
}

// masque : le texte tapé s'affiche en •••• (jetons, mots de passe)
export function saisir(message: string, defaut = '', masque = false): Promise<string> {
    return demander<string>((resoudre) => ({ type: 'saisie', message, defaut, masque, resoudre }));
}

export async function confirmer(message: string): Promise<boolean> {
    try {
        return await choisir(message, [{ label: 'Oui', valeur: true }, { label: 'Non', valeur: false }], false);
    } catch {
        return false;
    }
}

// Vue plein écran (moniteur) : la promesse se résout quand la vue appelle fermer()
export function afficherVue(rendu: (fermer: () => void) => ReactNode): Promise<void> {
    return new Promise((ok) => {
        bus.emit('demande', {
            type: 'vue', rendu, resoudre: () => {
                bus.emit('demande', undefined);
                ok();
            },
        } satisfies Demande);
    });
}

// Indicateur "✻ message…" pendant une opération longue
export async function tache<T>(message: string, fn: () => Promise<T> | T): Promise<T> {
    bus.emit('tache', message);
    // Laisse Ink afficher le spinner avant un éventuel travail synchrone
    await new Promise((r) => setTimeout(r, 30));
    try {
        return await fn();
    } finally {
        bus.emit('tache', undefined);
    }
}
