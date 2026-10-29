import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { ajouterMessage, dossierIntegre, lireIntegree, sauverIntegree } from './sessionsIntegrees.js';
import type { ContexteAgent, PermissionAgent, ReponsePermission } from './providers/types.js';
import { executerClaude } from './providers/claude.js';
import { executerCodex } from './providers/codex.js';
import { executerPerplexity } from './providers/perplexity.js';

export async function travailler(id: string, tour: string, executer?: (c: ContexteAgent) => Promise<string>): Promise<void> {
    const s = lireIntegree(id);
    if (!s || s.tour !== tour || s.etat !== 'travaille') return;
    const dossier = dossierIntegre(id), fichier = (nom: string) => path.join(dossier, nom);
    const controller = new AbortController();
    s.pid = process.pid;
    const sauver = () => sauverIntegree(s);
    sauver();
    let filePermission = Promise.resolve();
    const demander = async (p: Omit<PermissionAgent, 'id'>): Promise<ReponsePermission> => {
        const precede = filePermission;
        let liberer!: () => void;
        filePermission = new Promise<void>((ok) => { liberer = ok; });
        await precede;
        const permission = { ...p, id: randomUUID() };
        try {
            controller.signal.throwIfAborted();
            s.etat = 'bloquee'; s.permission = permission; sauver();
            const reponse = fichier(`reponse-${permission.id}.json`);
            while (!controller.signal.aborted) {
                if (fs.existsSync(reponse)) {
                    const r = JSON.parse(fs.readFileSync(reponse, 'utf8'));
                    fs.rmSync(reponse, { force: true });
                    if (r.tour === tour) return r;
                }
                await pause(250, undefined, { signal: controller.signal });
            }
            throw new Error('Tour interrompu');
        } finally { s.permission = undefined; s.etat = 'travaille'; sauver(); liberer(); }
    };
    const pouls = setInterval(() => {
        try {
            if (fs.existsSync(fichier('arret')) && JSON.parse(fs.readFileSync(fichier('arret'), 'utf8')).tour === tour) controller.abort();
            sauver();
        } catch { controller.abort(); }
    }, 1000);
    const arreter = () => controller.abort();
    process.once('SIGTERM', arreter); process.once('SIGINT', arreter);
    // Borne de durée pour qu'un fournisseur muet ne conserve pas un worker indéfiniment.
    const limite = setTimeout(arreter, 60 * 60_000);
    try {
        const r = JSON.parse(fs.readFileSync(fichier('requete.json'), 'utf8'));
        if (r.tour !== tour) throw new Error('Requête périmée');
        const historique: ContexteAgent['historique'] = [];
        if (s.fournisseur === 'perplexity' && fs.existsSync(fichier('conversation.jsonl'))) {
            for (const l of fs.readFileSync(fichier('conversation.jsonl'), 'utf8').split('\n').filter(Boolean)) {
                const m = JSON.parse(l);
                const texte = typeof m.message.content === 'string' ? m.message.content : m.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
                if (texte) historique.push({ role: m.type, content: texte });
            }
        }
        ajouterMessage(id, 'user', r.prompt);
        const contexte: ContexteAgent = { session: s, prompt: r.prompt, historique: historique.slice(-20), signal: controller.signal,
            evenement: (e) => ajouterMessage(id, e.role, e.texte, e.fichier), permission: demander,
            thread: (threadId) => { s.threadId = threadId; sauver(); },
        };
        const adaptateur = executer || ({ claude: executerClaude, codex: executerCodex, perplexity: executerPerplexity }[s.fournisseur]);
        s.resultat = await adaptateur(contexte);
        controller.signal.throwIfAborted();
        s.etat = 'attend'; s.issue = 'success';
    } catch (e) {
        s.etat = controller.signal.aborted ? 'arretee' : 'erreur';
        s.issue = controller.signal.aborted ? 'cancelled' : 'error';
        s.erreur = controller.signal.aborted ? 'Tour interrompu. La conversation peut être reprise.' : (e as Error).message;
        // Retirer les jetons usuels des messages d'erreur des bibliothèques.
        s.erreur = s.erreur.replace(/(?:sk-|pplx-)[\w-]+/g, '[clé masquée]').slice(0, 3000);
        ajouterMessage(id, 'assistant', `⚠ ${s.erreur}`);
    } finally {
        clearInterval(pouls); clearTimeout(limite);
        process.off('SIGTERM', arreter); process.off('SIGINT', arreter);
        s.permission = undefined; s.pid = undefined; sauver();
        fs.rmSync(fichier('requete.json'), { force: true });
        fs.rmSync(fichier('verrou'), { force: true });
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void travailler(process.argv[2], process.argv[3]).catch(() => { process.exitCode = 1; });
}
