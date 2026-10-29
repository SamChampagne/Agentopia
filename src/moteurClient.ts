import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { CHEMINS, surPath } from './chemins.js';
import { ecrireAtomique } from './sessionsIntegrees.js';
import { processusVivant } from './verrou.js';

export const DOSSIER_MOTEUR = CHEMINS.moteur;
export const localAuMoteur = () => process.env.AGENTOPIA_MOTEUR === '1' || process.env.AGENTOPIA_SANS_MOTEUR === '1';
export const moteurEnPause = () => fs.existsSync(path.join(DOSSIER_MOTEUR, 'pause.json'));
export function etatMoteur(): { actif: boolean; pause: boolean; pid?: number; erreur?: string; date?: number } {
    try { const s = JSON.parse(fs.readFileSync(path.join(DOSSIER_MOTEUR, 'etat.json'), 'utf8'));
        return { ...s, actif: processusVivant(s.pid) && Date.now() - s.date < 30_000, pause: moteurEnPause() }; }
    catch { return { actif: false, pause: moteurEnPause() }; }
}
let demarrage: Promise<void> | undefined;
export async function assurerMoteur(): Promise<void> {
    if (localAuMoteur() || process.env.CLAUDETOPIA_TEST_UI === '1' || etatMoteur().actif) return;
    if (demarrage) return demarrage;
    demarrage = (async () => {
        fs.mkdirSync(path.join(DOSSIER_MOTEUR, 'commandes'), { recursive: true });
        const node = surPath('node.exe') || surPath('node');
        if (!node) throw new Error('Node est introuvable : répare l’installation');
        const p = spawn(node, [fileURLToPath(new URL('./moteur.js', import.meta.url))], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, AGENTOPIA_MOTEUR: '1' } });
        await new Promise<void>((ok, ko) => { p.once('spawn', ok); p.once('error', ko); }); p.unref();
        for (let i = 0; i < 100; i++) { if (etatMoteur().actif) return; await pause(100); }
        throw new Error('Le moteur n’a pas démarré · Config → Moteur des équipes pour réessayer');
    })().finally(() => { demarrage = undefined; });
    return demarrage;
}
export type ActionMoteur = 'lancer' | 'arreter' | 'integrer' | 'relancer' | 'ecarter' | 'retirer' | 'ranger' | 'tout-arreter' | 'planification';
export async function commanderMoteur<T>(action: ActionMoteur, id?: string, tache?: string): Promise<T> {
    await assurerMoteur();
    const cle = `${Date.now()}-${randomUUID()}`, dossier = path.join(DOSSIER_MOTEUR, 'commandes');
    fs.mkdirSync(dossier, { recursive: true });
    ecrireAtomique(path.join(dossier, `${cle}.json`), { action, id, tache, creee: Date.now() });
    const reponse = path.join(dossier, `${cle}.reponse`);
    for (let i = 0; i < 600; i++) {
        if (fs.existsSync(reponse)) {
            const r = JSON.parse(fs.readFileSync(reponse, 'utf8')); fs.rmSync(reponse, { force: true });
            if (r.erreur) throw new Error(r.erreur); return r.resultat as T;
        }
        if (i > 30 && !etatMoteur().actif) throw new Error('Moteur interrompu. L’état du travail est conservé ; relance le moteur pour le vérifier.');
        await pause(100);
    }
    throw new Error('Le moteur traite encore la demande. Consulte son état avant de réessayer.');
}
export async function pauseGlobale(): Promise<void> {
    fs.mkdirSync(DOSSIER_MOTEUR, { recursive: true });
    ecrireAtomique(path.join(DOSSIER_MOTEUR, 'pause.json'), { date: Date.now() });
    await commanderMoteur('tout-arreter');
}
export async function reprendreMoteur(): Promise<void> {
    fs.rmSync(path.join(DOSSIER_MOTEUR, 'pause.json'), { force: true });
    await assurerMoteur();
}
