import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { surPath } from './chemins.js';
import { disponibilite } from './providers/config.js';
import { commencerUsage, sauverUsage } from './utilisation.js';
import type { Fournisseur, SessionIntegree, ReponsePermission } from './providers/types.js';

export const RACINE_SESSIONS = path.resolve(process.env.CLAUDETOPIA_DATA_DIR || path.join(os.homedir(), '.claudetopia-agents'));
export const estIntegree = (id: string) => /^ct-[0-9a-f-]{36}$/.test(id);
export function dossierIntegre(id: string): string {
    if (!estIntegree(id)) throw new Error('Identifiant de session invalide');
    return path.join(RACINE_SESSIONS, id);
}
export function ecrireAtomique(fichier: string, valeur: unknown): void {
    const temporaire = `${fichier}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporaire, JSON.stringify(valeur), { mode: 0o600 });
    try { fs.renameSync(temporaire, fichier); }
    finally { fs.rmSync(temporaire, { force: true }); }
}
export function lireIntegree(id: string): SessionIntegree | undefined {
    try { return JSON.parse(fs.readFileSync(path.join(dossierIntegre(id), 'etat.json'), 'utf8')); }
    catch { return undefined; }
}
export function sauverIntegree(s: SessionIntegree): void {
    s.maj = Date.now();
    ecrireAtomique(path.join(dossierIntegre(s.id), 'etat.json'), s);
}
export function listerIntegrees(avecArchives = false): SessionIntegree[] {
    try {
        return fs.readdirSync(RACINE_SESSIONS).filter(estIntegree).flatMap((id) => {
            const s = lireIntegree(id);
            if (!s || (!avecArchives && (s.archivee || fs.existsSync(path.join(dossierIntegre(id), 'archive'))))) return [];
            // Ne jamais déclarer un tour réussi parce que son processus a disparu.
            if (['travaille', 'bloquee'].includes(s.etat) && Date.now() - s.maj > 120_000) {
                let mort = !s.pid;
                if (s.pid) try { process.kill(s.pid, 0); } catch (e) { mort = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
                if (mort) {
                    s.etat = 'erreur'; s.issue = 'error'; s.erreur = 'Le processus a été interrompu. Tu peux reprendre la conversation.';
                    s.permission = undefined; sauverIntegree(s);
                    try { if (s.recuUsage) sauverUsage(s.recuUsage, s.utilisation ?? {}, 'error'); } catch { /* Le reçu reste incomplet si le disque est indisponible. */ }
                    fs.rmSync(path.join(dossierIntegre(id), 'verrou'), { force: true });
                }
            }
            return [s];
        });
    } catch { return []; }
}
export function creerIntegree(fournisseur: Fournisseur, cwd: string, titre: string, modele?: string): SessionIntegree {
    if (!fs.statSync(cwd).isDirectory()) throw new Error('Le dossier du projet est introuvable');
    const s: SessionIntegree = { id: `ct-${randomUUID()}`, fournisseur, cwd: path.resolve(cwd), titre, modele,
        creee: Date.now(), maj: Date.now(), tour: '', etat: 'attend' };
    fs.mkdirSync(dossierIntegre(s.id), { recursive: true, mode: 0o700 });
    sauverIntegree(s);
    return s;
}
export function ajouterMessage(id: string, role: 'user' | 'assistant' | 'outil', texte: string, fichier?: string): void {
    const content = role === 'user' ? texte : role === 'outil'
        ? [{ type: 'tool_use', name: texte, input: fichier ? { file_path: fichier } : {} }]
        : [{ type: 'text', text: texte }];
    fs.appendFileSync(path.join(dossierIntegre(id), 'conversation.jsonl'), JSON.stringify({
        type: role === 'user' ? 'user' : 'assistant', timestamp: new Date().toISOString(), message: { content },
    }) + '\n', { mode: 0o600 });
}
export async function envoyerIntegree(id: string, prompt: string): Promise<void> {
    const s = lireIntegree(id);
    if (!s) throw new Error('Session introuvable');
    if (!prompt.trim()) throw new Error('Le message est vide');
    const pret = disponibilite(s.fournisseur);
    if (!pret.pret) throw new Error(pret.texte);
    const dossier = dossierIntegre(id);
    if (fs.existsSync(path.join(dossier, 'archive'))) throw new Error('Cette session est archivée');
    const verrou = path.join(dossier, 'verrou');
    let fd: number;
    try { fd = fs.openSync(verrou, 'wx', 0o600); }
    catch { throw new Error('Un tour est déjà en cours. Attends la réponse ou utilise Interrompre.'); }
    fs.closeSync(fd);
    try {
        s.tour = randomUUID(); s.etat = 'travaille'; s.issue = undefined; s.erreur = undefined;
        s.permission = undefined; s.resultat = undefined; s.pid = undefined;
        s.dernierPrompt = prompt; s.utilisation = undefined; s.bilan = undefined; s.recuUsage = undefined;
        s.recuUsage = commencerUsage(s.id, s.fournisseur);
        fs.rmSync(path.join(dossier, 'arret'), { force: true });
        ecrireAtomique(path.join(dossier, 'requete.json'), { tour: s.tour, prompt });
        sauverIntegree(s);
        const node = surPath('node.exe') || surPath('node');
        if (!node) throw new Error('Node.js est requis pour les sessions intégrées');
        const enfant = spawn(node, [fileURLToPath(new URL('./sessionWorker.js', import.meta.url)), id, s.tour], {
            cwd: s.cwd, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
        });
        await new Promise<void>((ok, ko) => { enfant.once('spawn', ok); enfant.once('error', ko); });
        enfant.unref();
    } catch (e) {
        s.etat = 'erreur'; s.issue = 'error'; s.erreur = (e as Error).message; sauverIntegree(s);
        if (s.recuUsage) sauverUsage(s.recuUsage, {}, 'error');
        fs.rmSync(verrou, { force: true }); throw e;
    }
}
export function interrompreIntegree(id: string): void {
    const s = lireIntegree(id);
    if (s && ['travaille', 'bloquee'].includes(s.etat)) ecrireAtomique(path.join(dossierIntegre(id), 'arret'), { tour: s.tour });
}
export function archiverIntegree(id: string): void {
    interrompreIntegree(id);
    // Un marqueur indépendant évite d'écraser l'état que le worker est en train de sauver.
    fs.writeFileSync(path.join(dossierIntegre(id), 'archive'), '');
}
export function restaurerIntegree(id: string): void {
    if (!lireIntegree(id)) throw new Error('Session introuvable');
    fs.rmSync(path.join(dossierIntegre(id), 'archive'), { force: true });
}
export function repondrePermission(id: string, permissionId: string, reponse: ReponsePermission): void {
    const s = lireIntegree(id);
    if (!s?.permission || s.permission.id !== permissionId) throw new Error('Cette demande a expiré');
    ecrireAtomique(path.join(dossierIntegre(id), `reponse-${permissionId}.json`), { tour: s.tour, ...reponse });
}
