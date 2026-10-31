import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { surPath } from './chemins.js';
import { disponibilite } from './providers/config.js';
import { chargerConfig } from './config.js';
import { sousCapaciteAgent } from './fileAgents.js';
import { commencerUsage, sauverUsage } from './utilisation.js';
import type { Fournisseur, SessionIntegree, ReponsePermission, EvenementAgent } from './providers/types.js';
import { capacitesFournisseur, validerModele } from './providers/types.js';
import { prendreVerrou, sousVerrou, processusVivant, demarragePoste } from './verrou.js';
import { ecrireAtomique } from './stockageAtomique.js';
import { RACINE_SESSIONS, estIdentifiantSession, dossierSession, fichierSession, lireEtatSession, sauverEtatSession,
    estIdentifiantPermission, fichierReponsePermission, validerReponsePermission } from './stockageSessions.js';
export { ecrireAtomique } from './stockageAtomique.js';
export { RACINE_SESSIONS, fichierSession as fichierIntegre, lireEtatSession as lireIntegreeStrict } from './stockageSessions.js';

export const estIntegree = estIdentifiantSession;
export const dossierIntegre = dossierSession;
export function lireIntegree(id: string): SessionIntegree | undefined {
    try { return lireEtatSession(id); }
    catch { return undefined; }
}
export const sauverIntegree = sauverEtatSession;
const operation = (id: string) => fichierSession(id, 'operation');
const execution = (id: string) => fichierSession(id, 'execution');
const active = (s: SessionIntegree) => ['travaille', 'bloquee'].includes(s.etat);
const DELAI_LANCEMENT = 120_000;

// Appelé uniquement sous les deux verrous. Le verrou court sérialise les reprises ;
// celui d'exécution protège aussi la fenêtre entre l'état final et le nettoyage.
function recupererOrpheline(s: SessionIntegree): SessionIntegree {
    if (s.pid && processusVivant(s.pid, s.demarragePoste)) return s; // Compatibilité avec les anciens workers.
    const verrou = fichierSession(s.id, 'verrou');
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
        s.terminalExterne = undefined;
        s.permission = undefined; s.pid = undefined; s.demarragePoste = undefined; sauverIntegree(s);
        try { if (s.recuUsage) sauverUsage(s.recuUsage, s.utilisation ?? {}, 'error'); } catch { /* Reçu conservé pour diagnostic. */ }
    }
    fs.rmSync(verrou, { force: true });
    return s;
}

/** Le worker revendique son tour avant toute écriture ou appel au fournisseur. */
export function prendreExecution(id: string, tour: string): { session: SessionIntegree; liberer: () => void } | undefined {
    return sousVerrou(operation(id), () => {
        const s = lireEtatSession(id);
        if (!s || s.tour !== tour || s.etat !== 'travaille' || (s.pid && processusVivant(s.pid, s.demarragePoste))) return;
        const liberer = prendreVerrou(execution(id));
        if (!liberer) return;
        try {
            s.pid = process.pid; s.demarragePoste = demarragePoste();
            ecrireAtomique(fichierSession(id, 'verrou'), { tour, pid: process.pid, demarragePoste: s.demarragePoste });
            sauverIntegree(s);
            return { session: s, liberer };
        } catch (e) { liberer(); throw e; }
    });
}
export function terminerExecution(s: SessionIntegree): void {
    sousVerrou(operation(s.id), () => {
        if (lireEtatSession(s.id)?.tour !== s.tour) return;
        sauverIntegree(s);
        fs.rmSync(fichierSession(s.id, 'requete.json'), { force: true });
        fs.rmSync(fichierSession(s.id, 'verrou'), { force: true });
    });
}
export function listerIntegrees(avecArchives = false): SessionIntegree[] {
    try {
        return fs.readdirSync(RACINE_SESSIONS).filter(estIntegree).flatMap((id) => {
            try {
                let s = lireIntegree(id);
                if (!s || (!avecArchives && (s.archivee || fs.existsSync(fichierSession(id, 'archive'))))) return [];
                if (!active(s) && !fs.existsSync(fichierSession(id, 'verrou'))) return [s];
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
            } catch { return []; } // Un lien ou fichier invalide ne masque pas les autres sessions.
        });
    } catch { return []; }
}
export function modeleSessionValide(modele?: string): string | undefined {
    return validerModele(modele);
}
export function creerIntegree(fournisseur: Fournisseur, cwd: string, titre: string, options?: string | { modele?: string }): SessionIntegree {
    if (!fs.statSync(cwd).isDirectory()) throw new Error('Le dossier du projet est introuvable');
    const choix = typeof options === 'string' ? options : options?.modele;
    const modele = modeleSessionValide(choix ?? chargerConfig().modelesFournisseurs?.[fournisseur]);
    if (modele && !capacitesFournisseur(fournisseur).modele) throw new Error('Le choix de modèle n’est pas disponible pour ce fournisseur.');
    const s: SessionIntegree = { id: `ct-${randomUUID()}`, fournisseur, cwd: path.resolve(cwd), titre, modele,
        creee: Date.now(), maj: Date.now(), tour: '', etat: 'attend' };
    fs.mkdirSync(dossierIntegre(s.id), { recursive: true, mode: 0o700 });
    sauverIntegree(s);
    return s;
}
export function changerModeleIntegree(id: string, modele?: string): void {
    const valide = modeleSessionValide(modele);
    sousVerrou(operation(id), () => {
        const fin = prendreVerrou(execution(id)); if (!fin) throw new Error('Cette session travaille encore ou appartient au terminal.');
        try {
            const s = lireEtatSession(id); if (!s) throw new Error('Session introuvable');
            if (valide && !capacitesFournisseur(s.fournisseur).modele) throw new Error('Le choix de modèle n’est pas disponible pour ce fournisseur.');
            if (active(s) || s.terminalExterne || fs.existsSync(fichierSession(id, 'verrou'))) throw new Error('Attends la fin du tour ou ferme son terminal avant de changer de modèle.');
            s.modele = valide; sauverIntegree(s);
        } finally { fin(); }
    });
}
export function ajouterMessage(id: string, role: 'user' | 'assistant' | 'outil', texte: string, fichier?: string): void {
    const content = role === 'user' ? texte : role === 'outil'
        ? [{ type: 'tool_use', name: texte, input: fichier ? { file_path: fichier } : {} }]
        : [{ type: 'text', text: texte }];
    fs.appendFileSync(fichierSession(id, 'conversation.jsonl'), JSON.stringify({
        type: role === 'user' ? 'user' : 'assistant', timestamp: new Date().toISOString(), message: { content },
    }) + '\n', { mode: 0o600 });
}
export function ajouterEvenement(id: string, tour: string, evenement: EvenementAgent): void {
    if (!evenement.id) return ajouterMessage(id, evenement.role, evenement.texte, evenement.fichier);
    const e = { ...evenement, id: `${tour}/${evenement.id}` };
    fs.appendFileSync(fichierSession(id, 'conversation.jsonl'), JSON.stringify({ type: 'assistant',
        timestamp: new Date().toISOString(), agentopia: e,
        message: { content: e.role === 'assistant' ? [{ type: 'text', text: e.texte }] : e.fichiers?.length
            ? e.fichiers.map((f) => ({ type: 'tool_use', name: 'Edit', input: { file_path: f } }))
            : [{ type: 'tool_use', name: e.texte, input: { command: e.commande, file_path: e.fichier } }] },
    }) + '\n', { mode: 0o600 });
}
export async function envoyerIntegree(id: string, prompt: string): Promise<void> {
    let s = lireEtatSession(id);
    if (!s) throw new Error('Session introuvable');
    if (!prompt.trim()) throw new Error('Le message est vide');
    const pret = disponibilite(s.fournisseur);
    if (!pret.pret) throw new Error(pret.texte);
    if (fs.existsSync(fichierSession(id, 'archive'))) throw new Error('Cette session est archivée');
    const verrou = fichierSession(id, 'verrou');
    const lancement = sousVerrou(operation(id), () => sousCapaciteAgent(id, s!.fournisseur, () => {
        const finExecution = prendreVerrou(execution(id));
        if (!finExecution) throw new Error('Un tour est déjà en cours. Attends la réponse ou utilise Interrompre.');
        try {
            s = lireEtatSession(id);
            if (!s) throw new Error('Session introuvable');
            if (fs.existsSync(fichierSession(id, 'archive'))) throw new Error('Cette session est archivée');
            s = recupererOrpheline(s);
            if (active(s) || fs.existsSync(verrou)) throw new Error('Un tour est déjà en cours. Attends la réponse ou utilise Interrompre.');
            try {
                s.tour = randomUUID(); s.etat = 'travaille'; s.issue = undefined; s.erreur = undefined;
                ecrireAtomique(verrou, { tour: s.tour, lancement: process.pid });
                s.permission = undefined; s.resultat = undefined; s.pid = undefined; s.demarragePoste = undefined;
                s.dernierPrompt = prompt; s.utilisation = undefined; s.bilan = undefined; s.recuUsage = undefined;
                s.recuUsage = commencerUsage(s.id, s.fournisseur);
                fs.rmSync(fichierSession(id, 'arret'), { force: true });
                ecrireAtomique(fichierSession(id, 'requete.json'), { tour: s.tour, prompt });
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
    }));
    try { await lancement; }
    catch (e) {
        sousVerrou(operation(id), () => {
            const actuelle = lireEtatSession(id);
            if (!actuelle || actuelle.tour !== s!.tour || actuelle.pid) return;
            actuelle.etat = 'erreur'; actuelle.issue = 'error'; actuelle.erreur = (e as Error).message;
            try { sauverIntegree(actuelle); if (actuelle.recuUsage) sauverUsage(actuelle.recuUsage, {}, 'error'); }
            finally { fs.rmSync(verrou, { force: true }); }
        });
        throw e;
    }
}
export function interrompreIntegree(id: string): void {
    const s = lireEtatSession(id);
    if (s && ['travaille', 'bloquee'].includes(s.etat)) ecrireAtomique(fichierSession(id, 'arret'), { tour: s.tour });
}
export function archiverIntegree(id: string): void {
    interrompreIntegree(id);
    // Un marqueur indépendant évite d'écraser l'état que le worker est en train de sauver.
    fs.writeFileSync(fichierSession(id, 'archive'), '');
}
export function restaurerIntegree(id: string): void {
    if (!lireEtatSession(id)) throw new Error('Session introuvable');
    fs.rmSync(fichierSession(id, 'archive'), { force: true });
}
export function repondrePermission(id: string, permissionId: string, reponse: ReponsePermission): void {
    if (!estIdentifiantPermission(permissionId)) throw new Error('Identifiant de permission invalide');
    const valeur = validerReponsePermission(reponse);
    sousVerrou(operation(id), () => {
        const s = lireEtatSession(id);
        if (!s?.permission || s.etat !== 'bloquee' || s.permission.id !== permissionId) throw new Error('Cette demande a expiré');
        ecrireAtomique(fichierReponsePermission(dossierIntegre(id), permissionId), { session: id, permission: permissionId, tour: s.tour, ...valeur });
    });
}
