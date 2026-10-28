import { spawnSync } from 'child_process';
import { activer, desactiver } from './terminal.js';
import { invaliderEcran } from './sortie.js';

// Cycle de vie de l'interface plein écran, et "passer la main" à un autre programme
// (claude attach, ssh…) qui prend tout le terminal puis nous le rend.

let monter: () => void = () => undefined;
let demonter: () => void = () => undefined;

export function definirCycle(m: () => void, d: () => void): void {
    monter = m;
    demonter = d;
}

export function demarrerEcran(): void {
    activer();
    invaliderEcran();
    monter();
}

export function quitterEcran(): void {
    demonter();
    desactiver();
}

// Comment l'interface rend le terminal puis le reprend : Ink par défaut, une autre interface (tui/) fournit les siens
let ceder: () => void | Promise<void> = () => {
    demonter();
    desactiver();
    process.stdout.write('\x1b[2J\x1b[H');
};
let reprendre: () => void | Promise<void> = () => {
    activer();
    invaliderEcran();
    monter();
};
export function definirPassage(c: () => void | Promise<void>, r: () => void | Promise<void>): void {
    ceder = c;
    reprendre = r;
}

export async function passerLaMain(programme: string, args: string[], cwd?: string): Promise<number> {
    await ceder();
    const res = spawnSync(programme, args, { stdio: 'inherit', cwd, shell: programme === 'claude' });
    await reprendre();
    return res.status ?? 1;
}
