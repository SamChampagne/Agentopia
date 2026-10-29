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
import { prendreVerrou, sousVerrou, processusVivant, demarragePoste } from './verrou.js';

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
const operation = (id: string) => path.join(dossierIntegre(id), 'operation');
const execution = (id: string) => path.join(dossierIntegre(id), 'execution');
const active = (s: SessionIntegree) => ['travaille', 'bloquee'].includes(s.etat);
const DELAI_LANCEMENT = 120_000;

// Appelé uniquement sous les deux verrous. Le verrou court sérialise les reprises ;
// celui d'exécution protège aussi la fenêtre entre l'état final et le nettoyage.
function recupererOrpheline(s: SessionIntegree): SessionIntegree {
    if (s.pid && processusVivant(s.pid, s.demarragePoste)) return s; // Compatibilité avec les anciens workers.
    const verrou = path.join(dossierIntegre(s.id), 'verrou');
    let date = s.maj, proprietaire: { pid?: number; demarragePoste?: number } = {};
    try {
        date = fs.statSync(verrou).mtimeMs;
        try { proprietaire = JSON.parse(fs.readFileSync(verrou, 'utf8')) ?? {}; } catch { /* Ancien verrou vide. */ }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    // Un lancement sans PID peut encore arriver au worker. On ne le reprend pas trop tôt.
    // Les anciens workers sauvent l'état final avant de retirer leur verrou vide.
    // Leur dernière écriture protège aussi cette courte fenêtre de nettoyage.
    if (!s.pid && Date.now() - Math.max(date, s.maj) < DELAI_LANCEMENT) return s;
    if (proprietaire.pid && processusVivant(proprietaire.pid, proprietaire.demarragePoste) && !active(s)) return s;
    if (active(s)) {
        s.etat = 'erreur'; s.issue = 'error'; s.erreur = 'Le processus a été interrompu. Tu peux reprendre la conversation.';
        s.permission = undefined; s.pid = undefined; s.demarragePoste = undefined; sauverIntegree(s);
        try { if (s.recuUsage) sauverUsage(s.recuUsage, s.utilisation ?? {}, 'error'); } catch { /* Reçu conservé pour diagnostic. */ }
    }
    fs.rmSync(verrou, { force: true });
    return s;
}

/** Le worker revendique son tour avant toute écriture ou appel au fournisseur. */
export function prendreExecution(id: string, tour: string): { session: SessionIntegree; liberer: () => void } | undefined {
    return sousVerrou(operation(id), () => {
        const s = lireIntegree(id);
        if (!s || s.tour !== tour || s.etat !== 'travaille' || (s.pid && processusVivant(s.pid, s.demarragePoste))) return;
        const liberer = prendreVerrou(execution(id));
        if (!liberer) return;
        try {
            s.pid = process.pid; s.demarragePoste = demarragePoste();
            ecrireAtomique(path.join(dossierIntegre(id), 'verrou'), { tour, pid: process.pid, demarragePoste: s.demarragePoste });
            sauverIntegree(s);
            return { session: s, liberer };
        } catch (e) { liberer(); throw e; }
    });
}
export function terminerExecution(s: SessionIntegree): void {
    sousVerrou(operation(s.id), () => {
        if (lireIntegree(s.id)?.tour !== s.tour) return;
        sauverIntegree(s);
        fs.rmSync(path.join(dossierIntegre(s.id), 'requete.json'), { force: true });
        fs.rmSync(path.join(dossierIntegre(s.id), 'verrou'), { force: true });
    });
}
export function listerIntegrees(avecArchives = false): SessionIntegree[] {
    try {
        return fs.readdirSync(RACINE_SESSIONS).filter(estIntegree).flatMap((id) => {
            let s = lireIntegree(id);
            if (!s || (!avecArchives && (s.archivee || fs.existsSync(path.join(dossierIntegre(id), 'archive'))))) return [];
            if (!active(s) && !fs.existsSync(path.join(dossierIntegre(id), 'verrou'))) return [s];
            // Une session défectueuse ne doit pas masquer toutes les autres.
            try {
                const finOperation = prendreVerrou(operation(id));
                if (finOperation) try {
                    const finExecution = prendreVerrou(execution(id));
                    if (finExecution) try { const actuelle = lireIntegree(id); if (actuelle) s = recupererOrpheline(actuelle); }
                    finally { finExecution(); }
                } finally { finOperation(); }
            } catch { /* Lecture seule si le disque est temporairement indisponible. */ }
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
    let s = lireIntegree(id);
    if (!s) throw new Error('Session introuvable');
    if (!prompt.trim()) throw new Error('Le message est vide');
    const pret = disponibilite(s.fournisseur);
    if (!pret.pret) throw new Error(pret.texte);
    const dossier = dossierIntegre(id);
    if (fs.existsSync(path.join(dossier, 'archive'))) throw new Error('Cette session est archivée');
    const verrou = path.join(dossier, 'verrou');
    const lancement = sousVerrou(operation(id), () => {
        const finExecution = prendreVerrou(execution(id));
        if (!finExecution) throw new Error('Un tour est déjà en cours. Attends la réponse ou utilise Interrompre.');
        try {
            s = lireIntegree(id);
            if (!s) throw new Error('Session introuvable');
            s = recupererOrpheline(s);
            if (active(s) || fs.existsSync(verrou)) throw new Error('Un tour est déjà en cours. Attends la réponse ou utilise Interrompre.');
            try {
                s.tour = randomUUID(); s.etat = 'travaille'; s.issue = undefined; s.erreur = undefined;
                ecrireAtomique(verrou, { tour: s.tour, lancement: process.pid });
                s.permission = undefined; s.resultat = undefined; s.pid = undefined; s.demarragePoste = undefined;
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
                return new Promise<void>((ok, ko) => { enfant.once('spawn', () => { enfant.unref(); ok(); }); enfant.once('error', ko); });
            } catch (e) {
                s.etat = 'erreur'; s.issue = 'error'; s.erreur = (e as Error).message;
                try { sauverIntegree(s); if (s.recuUsage) sauverUsage(s.recuUsage, {}, 'error'); }
                finally { fs.rmSync(verrou, { force: true }); }
                throw e;
            }
        } finally { finExecution(); }
    });
    try { await lancement; }
    catch (e) {
        sousVerrou(operation(id), () => {
            const actuelle = lireIntegree(id);
            if (!actuelle || actuelle.tour !== s!.tour || actuelle.pid) return;
            actuelle.etat = 'erreur'; actuelle.issue = 'error'; actuelle.erreur = (e as Error).message;
            try { sauverIntegree(actuelle); if (actuelle.recuUsage) sauverUsage(actuelle.recuUsage, {}, 'error'); }
            finally { fs.rmSync(verrou, { force: true }); }
        });
        throw e;
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
