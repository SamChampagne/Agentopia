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
export const VERSION_MOTEUR = '1.2.0';
export const localAuMoteur = () => process.env.AGENTOPIA_MOTEUR === '1' || process.env.AGENTOPIA_SANS_MOTEUR === '1';
export const moteurEnPause = () => fs.existsSync(path.join(DOSSIER_MOTEUR, 'pause.json'));
export function etatMoteur(): { actif: boolean; pause: boolean; pid?: number; erreur?: string; date?: number; version?: string } {
    try { const s = JSON.parse(fs.readFileSync(path.join(DOSSIER_MOTEUR, 'etat.json'), 'utf8'));
        return { ...s, actif: processusVivant(s.pid) && Date.now() - s.date < 30_000, pause: moteurEnPause() }; }
    catch { return { actif: false, pause: moteurEnPause() }; }
}
let demarrage: Promise<void> | undefined;
export async function assurerMoteur(accepterAncien = false): Promise<void> {
    const courant = etatMoteur();
    const compatible = (e: ReturnType<typeof etatMoteur>) => e.actif && (accepterAncien || !!e.version && e.version.localeCompare(VERSION_MOTEUR, undefined, { numeric: true }) >= 0);
    if (localAuMoteur() || process.env.CLAUDETOPIA_TEST_UI === '1' || compatible(courant)) return;
    if (demarrage) return demarrage;
    demarrage = (async () => {
        const ancien = etatMoteur();
        if (compatible(ancien)) return;
        if (ancien.actif) {
            const equipes = fs.existsSync(CHEMINS.equipes) ? JSON.parse(fs.readFileSync(CHEMINS.equipes, 'utf8')) : [];
            const dossierCommandes = path.join(DOSSIER_MOTEUR, 'commandes');
            const demandes = fs.existsSync(dossierCommandes) && fs.readdirSync(dossierCommandes).some((n) => /\.(json|en-cours)$/.test(n));
            if (equipes.some((e: any) => ['en cours', 'integration'].includes(e.etat)) || demandes) throw new Error('Ancien moteur encore au travail. Laisse finir les équipes ou utilise /tout-arreter ; le moteur sera ensuite mis à niveau automatiquement.');
            const proprietaire = JSON.parse(fs.readFileSync(path.join(DOSSIER_MOTEUR, 'instance', 'proprietaire.json'), 'utf8'));
            if (proprietaire.pid !== ancien.pid) throw new Error('Le propriétaire du moteur a changé ; réessaie dans un instant');
            try { process.kill(ancien.pid!, 'SIGTERM'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
            for (let i = 0; i < 50 && processusVivant(ancien.pid!); i++) await pause(100);
            if (processusVivant(ancien.pid!)) throw new Error('L’ancien moteur termine une opération ; réessaie dans un instant');
        }
        fs.mkdirSync(path.join(DOSSIER_MOTEUR, 'commandes'), { recursive: true });
        const node = surPath('node.exe') || surPath('node');
        if (!node) throw new Error('Node est introuvable : répare l’installation');
        const p = spawn(node, [fileURLToPath(new URL('./moteur.js', import.meta.url))], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, AGENTOPIA_MOTEUR: '1' } });
        await new Promise<void>((ok, ko) => { p.once('spawn', ok); p.once('error', ko); }); p.unref();
        for (let i = 0; i < 100; i++) { if (compatible(etatMoteur())) return; await pause(100); }
        throw new Error('Le moteur n’a pas démarré · Config → Moteur des équipes pour réessayer');
    })().finally(() => { demarrage = undefined; });
    return demarrage;
}
export type ActionMoteur = 'lancer' | 'arreter' | 'integrer' | 'relancer' | 'reprendre' | 'ecarter' | 'retirer' | 'ranger' | 'tout-arreter' | 'planification';
export async function commanderMoteur<T>(action: ActionMoteur, id?: string, tache?: string): Promise<T> {
    await assurerMoteur(['tout-arreter', 'arreter', 'ranger'].includes(action));
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
