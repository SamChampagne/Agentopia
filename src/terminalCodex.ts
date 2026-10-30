import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { fichierIntegre, lireIntegreeStrict, sauverIntegree, ajouterMessage, ajouterEvenement, terminerExecution } from './sessionsIntegrees.js';
import { prendreVerrou, sousVerrou, demarragePoste } from './verrou.js';
import { CodexRpc } from './providers/codexRpc.js';
import { binaireCodex } from './providers/config.js';
import { creerFluxCodex } from './providers/fluxCodex.js';
import { quotePS } from './lanceurs.js';
import { surPath } from './chemins.js';
import type { SessionIntegree } from './providers/types.js';

export function verifierRepriseTerminal(s: SessionIntegree | undefined) {
    if (!s || s.fournisseur !== 'codex') throw new Error('Cette action demande une session Codex.');
    if (s.archivee || fs.existsSync(fichierIntegre(s.id, 'archive'))) throw new Error('Cette session est archivée.');
    if (s.terminalExterne) throw new Error('Cette conversation est déjà ouverte dans un terminal Codex.');
    if (['travaille', 'bloquee'].includes(s.etat)) throw new Error('Attends la fin du tour, ou interromps-le, avant de reprendre dans le terminal.');
    if (!s.threadId || !/^[0-9a-f-]{36}$/i.test(s.threadId)) throw new Error('Envoie un premier message dans Agentopia pour créer la conversation Codex.');
    if (s.origine?.copieAuProchainMessage) throw new Error('Envoie d’abord un message dans cette reprise importée pour créer sa conversation indépendante.');
    return s;
}
export async function ouvrirCodexTerminal(id: string, aCote = false) {
    const s = verifierRepriseTerminal(lireIntegreeStrict(id));
    if (!binaireCodex()) throw new Error('Codex CLI est introuvable · /fournisseurs codex');
    const node = surPath('node.exe') || surPath('node');
    if (!node) throw new Error('Node est introuvable pour ouvrir la session.');
    // Un serveur Windows Terminal déjà ouvert peut avoir un environnement ancien.
    const environnement = ['CODEX_HOME', 'CLAUDETOPIA_DATA_DIR'].map((cle) => `$env:${cle} = ${process.env[cle] ? quotePS(process.env[cle]!) : '$null'}`).join('; ');
    const commande = `${environnement}; & ${quotePS(node)} ${quotePS(fileURLToPath(new URL('./terminalCodex.js', import.meta.url)))} ${quotePS(id)}`;
    const shell = surPath('pwsh.exe') || surPath('powershell.exe');
    if (!shell) throw new Error('PowerShell est introuvable pour ouvrir le terminal.');
    const encode = (texte: string) => Buffer.from(texte, 'utf16le').toString('base64');
    const wt = surPath('wt.exe');
    const cote = aCote && !!process.env.WT_SESSION;
    const args = ['-w', cote ? '0' : 'new', ...(cote ? ['split-pane', '-V', '--size', '0.5'] : ['new-tab']),
        '--title', `Codex · ${s.titre}`, '--suppressApplicationTitle', '-d', s.cwd, shell, '-NoProfile', '-NoExit', '-EncodedCommand', encode(commande)];
    // Sans Windows Terminal, PowerShell ouvre une fenêtre interactive dédiée.
    const fallback = `Start-Process -FilePath ${quotePS(shell)} -WorkingDirectory ${quotePS(s.cwd)} -WindowStyle Normal -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand',${quotePS(encode(commande))}) -ErrorAction Stop`;
    await new Promise<void>((ok, ko) => {
        const p = spawn(wt || shell, wt ? args : ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(fallback)], { windowsHide: true, stdio: 'ignore' });
        p.once('error', ko);
        p.once('exit', (code) => code === 0 ? ok() : ko(new Error(`Le terminal n’a pas pu s’ouvrir (code ${code}).`)));
    });
}
type Services = { rpc?: Pick<CodexRpc, 'demander'>; lancer?: (s: SessionIntegree) => Promise<number> };
export async function executerTerminalCodex(id: string, services: Services = {}) {
    const { s, liberer } = sousVerrou(fichierIntegre(id, 'operation'), () => {
        const s = verifierRepriseTerminal(lireIntegreeStrict(id));
        const liberer = prendreVerrou(fichierIntegre(id, 'execution'));
        if (!liberer) throw new Error('Un autre tour ou terminal contrôle cette conversation.');
        try {
            s.tour = randomUUID(); s.terminalExterne = true; s.etat = 'travaille'; s.permission = undefined;
            s.pid = process.pid; s.demarragePoste = demarragePoste(); s.erreur = undefined;
            fs.rmSync(fichierIntegre(id, 'arret'), { force: true }); sauverIntegree(s);
            return { s, liberer };
        } catch (e) { liberer(); throw e; }
    });
    let rpc: Pick<CodexRpc, 'demander'> | undefined;
    let intervalle: ReturnType<typeof setInterval> | undefined, lecture: Promise<void> | undefined;
    let code = 1;
    let dernierTour: any;
    const issueAvant = s.issue;
    const vus = new Map<string, string>();
    const commandes = new Map<string, { commande: string; codeSortie?: number }>();
    const flux = creerFluxCodex((e) => {
        ajouterEvenement(id, 'terminal-codex', e);
        if (e.commande && e.id && e.etat !== 'en_cours') commandes.set(e.id, { commande: e.commande, codeSortie: e.codeSortie });
    });
    try {
        rpc = services.rpc ?? new CodexRpc();
        if (!services.rpc) await (rpc as CodexRpc).initialiser();
        const avant = await rpc.demander('thread/read', { threadId: s.threadId, includeTurns: true });
        const anciens = new Set((avant.thread?.turns || []).map((t: any) => t.id));
        const synchroniser = async () => {
            const r = await rpc!.demander('thread/read', { threadId: s.threadId, includeTurns: true });
            for (const t of r.thread?.turns || []) {
                if (anciens.has(t.id)) continue;
                dernierTour = t;
                for (const item of t.items || []) {
                    const cle = `${t.id}/${item.id}`, empreinte = JSON.stringify(item);
                    if (vus.get(cle) === empreinte) continue;
                    if (item.type === 'userMessage' && !vus.has(cle)) {
                        const texte = (item.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
                        if (texte) { ajouterMessage(id, 'user', texte); s.dernierPrompt = texte; }
                    } else {
                        const enCours = item.status === 'inProgress' || (!item.status && t.status === 'inProgress' && item === t.items.at(-1));
                        flux.recevoir(enCours ? 'item/started' : 'item/completed', { item: { ...item, id: cle } });
                    }
                    vus.set(cle, empreinte);
                }
            }
            if (flux.resultat()) s.resultat = flux.resultat();
            if (dernierTour) {
                s.bilan = { commandes: [...commandes.values()].slice(-50), resume: s.resultat };
                s.utilisation = undefined; s.recuUsage = undefined;
            }
            sauverIntegree(s);
        };
        intervalle = setInterval(() => {
            if (lecture) return;
            lecture = synchroniser().catch(() => { /* Nouvelle tentative au prochain relevé, contrôle exclusif conservé. */ }).finally(() => { lecture = undefined; });
        }, 1500);
        console.log('Même conversation Codex. Agentopia reste en lecture seule jusqu’à la fermeture de Codex.');
        if (services.lancer) code = await services.lancer(s);
        else code = await lancerCli(s);
        clearInterval(intervalle); await lecture;
        try { await synchroniser(); }
        catch { s.erreur = 'Le terminal est fermé, mais son historique n’a pas pu être relu. La conversation Codex reste conservée ; vérifie la connexion.'; }
        if (s.erreur || dernierTour?.status === 'failed') {
            s.etat = 'erreur'; s.issue = 'error'; s.erreur ??= dernierTour.error?.message || 'Le dernier tour Codex a échoué.';
        } else if (code !== 0 || dernierTour && dernierTour.status !== 'completed') {
            s.etat = 'arretee'; s.issue = 'cancelled';
        } else { s.etat = 'attend'; s.issue = dernierTour ? 'success' : issueAvant; }
    } catch (e) {
        s.etat = 'erreur'; s.issue = 'error'; s.erreur = (e as Error).message; throw e;
    } finally {
        clearInterval(intervalle); await lecture;
        flux.fermer(s.issue === 'success');
        if (!services.rpc && rpc) (rpc as CodexRpc).fermer();
        s.terminalExterne = undefined; s.pid = undefined; s.demarragePoste = undefined;
        try { terminerExecution(s); } finally { liberer(); }
    }
}
function lancerCli(s: SessionIntegree): Promise<number> {
    return new Promise((ok, ko) => {
        const binaire = binaireCodex();
        if (!binaire) return ko(new Error('Codex CLI est introuvable.'));
        const p = spawn(binaire, ['resume', s.threadId!, '-C', s.cwd, '-s', s.lectureSeule ? 'read-only' : 'workspace-write', '-a', 'on-request'], { cwd: s.cwd, stdio: 'inherit' });
        p.once('spawn', () => { s.pid = p.pid; sauverIntegree(s); });
        const arret = setInterval(() => {
            try { if (JSON.parse(fs.readFileSync(fichierIntegre(s.id, 'arret'), 'utf8')).tour === s.tour) p.kill(); } catch { /* Pas de demande d'arrêt. */ }
        }, 500);
        p.once('error', (e) => { clearInterval(arret); ko(e); });
        p.once('exit', (code) => { clearInterval(arret); ok(code ?? 1); });
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Ctrl+C est traité par Codex ; le gardien conserve le verrou jusqu'à sa fermeture.
    process.on('SIGINT', () => {});
    void executerTerminalCodex(process.argv[2]).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
