import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ajouterMessage, dossierIntegre, sauverIntegree, prendreExecution, terminerExecution } from './sessionsIntegrees.js';
import type { ContexteAgent, SessionIntegree } from './providers/types.js';
import { executerClaude } from './providers/claude.js';
import { executerCodex } from './providers/codex.js';
import { executerPerplexity } from './providers/perplexity.js';
import { chargerConfig } from './config.js';
import { sauverUsage, normaliserUsage } from './utilisation.js';
import { spawnSync } from 'node:child_process';
import { HorlogeTravail } from './horlogeTravail.js';
import { creerDemandesPermission } from './demandesPermission.js';

export async function travailler(id: string, tour: string, executer?: (c: ContexteAgent) => Promise<string>): Promise<void> {
    const execution = prendreExecution(id, tour);
    if (!execution) return;
    try { await executerTour(execution.session, executer); }
    finally { execution.liberer(); }
}
async function executerTour(s: SessionIntegree, executer?: (c: ContexteAgent) => Promise<string>): Promise<void> {
    const { id, tour } = s;
    const dossier = dossierIntegre(id), fichier = (nom: string) => path.join(dossier, nom);
    const controller = new AbortController();
    let termine = false;
    s.pid = process.pid;
    s.bilan = { commandes: [] };
    const sauver = () => { if (!termine) sauverIntegree(s); };
    sauver();
    const minutes = Math.max(1, Math.min(180, chargerConfig().limitesAgents?.dureeMinutes || 60));
    let delaiAtteint = false;
    const horloge = new HorlogeTravail(minutes * 60_000, () => { delaiAtteint = true; controller.abort(); });
    const demander = creerDemandesPermission({ dossier, tour, signal: controller.signal,
        suspendre: () => horloge.suspendre(),
        publier: (permission) => {
            if (termine) return;
            s.permission = permission; s.etat = permission ? 'bloquee' : 'travaille'; sauver();
        },
    });
    const pouls = setInterval(() => {
        try {
            if (fs.existsSync(fichier('arret')) && JSON.parse(fs.readFileSync(fichier('arret'), 'utf8')).tour === tour) controller.abort();
            sauver();
        } catch { controller.abort(); }
    }, 1000);
    const arreter = () => controller.abort();
    process.once('SIGTERM', arreter); process.once('SIGINT', arreter);
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
            evenement: (e) => {
                if (termine) return;
                ajouterMessage(id, e.role, e.texte, e.fichier);
                if (e.commande) s.bilan!.commandes.push({ commande: e.commande.slice(0, 1000), codeSortie: e.codeSortie });
                if (s.bilan!.commandes.length > 50) s.bilan!.commandes.shift();
            }, permission: demander,
            utilisation: (usage) => { if (termine) return; s.utilisation = normaliserUsage(usage); if (s.recuUsage) sauverUsage(s.recuUsage, s.utilisation); },
            thread: (threadId) => { if (termine) return; s.threadId = threadId; sauver(); },
        };
        const adaptateur = executer || ({ claude: executerClaude, codex: executerCodex, perplexity: executerPerplexity }[s.fournisseur]);
        s.resultat = await adaptateur(contexte);
        s.bilan.resume = s.resultat;
        controller.signal.throwIfAborted();
        s.etat = 'attend'; s.issue = 'success';
    } catch (e) {
        s.etat = controller.signal.aborted ? 'arretee' : 'erreur';
        s.issue = controller.signal.aborted ? 'cancelled' : 'error';
        s.erreur = delaiAtteint ? `Limite de ${minutes} minutes de travail atteinte (attente utilisateur exclue). Config → Limites des agents, puis Reprendre.`
            : controller.signal.aborted ? 'Tour interrompu. La conversation peut être reprise.' : (e as Error).message;
        // Retirer les jetons usuels des messages d'erreur des bibliothèques.
        s.erreur = s.erreur.replace(/(?:sk-|pplx-)[\w-]+/g, '[clé masquée]').slice(0, 3000);
        ajouterMessage(id, 'assistant', `⚠ ${s.erreur}`);
    } finally {
        termine = true; controller.abort();
        clearInterval(pouls); horloge.arreter(); s.bilan.durees = horloge.bilan();
        process.off('SIGTERM', arreter); process.off('SIGINT', arreter);
        s.permission = undefined; s.pid = undefined; s.demarragePoste = undefined;
        if (s.fournisseur !== 'perplexity') {
            const r = spawnSync('git', ['status', '--short'], { cwd: s.cwd, windowsHide: true, encoding: 'utf8', timeout: 5000 });
            if (r.status === 0) s.bilan!.fichiers = r.stdout.trim() || 'Dossier propre (les changements peuvent déjà être commités).';
        }
        try { if (s.recuUsage) sauverUsage(s.recuUsage, s.utilisation ?? {}, s.issue ?? 'error'); }
        finally { terminerExecution(s); }
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void travailler(process.argv[2], process.argv[3]).catch(() => { process.exitCode = 1; });
}
