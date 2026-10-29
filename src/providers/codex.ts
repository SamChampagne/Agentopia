import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { binaireCodex } from './config.js';
import type { ContexteAgent } from './types.js';
import { normaliserUsage } from '../utilisation.js';
import { VERSION_AGENTOPIA } from '../version.js';
import { creerFluxCodex } from './fluxCodex.js';

// Une connexion app-server par tour. Le thread persistant de Codex porte l'historique.
// Le transport injectable permet de vérifier le protocole sans appel à un modèle.
export async function executerCodex(c: ContexteAgent, transport?: ChildProcessWithoutNullStreams): Promise<string> {
    const binaire = binaireCodex();
    if (!binaire && !transport) throw new Error('Codex CLI est introuvable · /fournisseurs');
    const proc = transport || spawn(binaire!, ['app-server'], { cwd: c.session.cwd, windowsHide: true, stdio: 'pipe' });
    const lignes = createInterface({ input: proc.stdout });
    let seq = 0, termine = false;
    const attentes = new Map<number, { ok: (r: any) => void; ko: (e: Error) => void; timer: NodeJS.Timeout }>();
    let finir!: () => void, echouer!: (e: Error) => void;
    const fin = new Promise<void>((ok, ko) => { finir = ok; echouer = ko; });
    // Une fermeture précoce peut précéder l'attente du résultat du tour.
    void fin.catch(() => {});
    const flux = creerFluxCodex(c.evenement);
    let tourLance = false;
    let avant = c.session.threadId ? c.session.compteursCodex : { entree: 0, sortie: 0, cache: 0 };
    const envoyer = (objet: unknown) => { if (!proc.stdin.destroyed) proc.stdin.write(JSON.stringify(objet) + '\n'); };
    const requete = (method: string, params: unknown) => new Promise<any>((ok, ko) => {
        const id = ++seq;
        const timer = setTimeout(() => { attentes.delete(id); ko(new Error(`Codex ne répond pas à ${method}`)); }, 45_000);
        attentes.set(id, { ok, ko, timer }); envoyer({ id, method, params });
    });
    const erreur = (e: Error) => {
        for (const a of attentes.values()) { clearTimeout(a.timer); a.ko(e); }
        attentes.clear(); if (!termine) echouer(e);
    };
    const arreter = () => { erreur(new Error('Tour interrompu')); proc.kill(); };
    proc.on('error', erreur);
    proc.on('exit', () => erreur(new Error('Codex a fermé la connexion sans résultat final')));
    proc.stdin.on('error', erreur);
    // stderr peut contenir des chemins ou des données de configuration : pas de copie dans le transcript.
    proc.stderr.resume();
    c.signal.addEventListener('abort', arreter, { once: true });
    const demande = async (m: any) => {
        const p = m.params || {};
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(m.method)) {
            const r = await c.permission({ titre: p.reason || 'Autorisation Codex', detail: JSON.stringify(p, null, 2),
                action: m.method === 'item/fileChange/requestApproval' ? 'fichiers' : 'commande',
                commande: typeof p.command === 'string' ? p.command : undefined, dossier: p.cwd || c.session.cwd });
            envoyer({ id: m.id, result: { decision: r.accepte ? 'accept' : 'decline' } });
        } else if (m.method === 'item/tool/requestUserInput') {
            const questions = (p.questions || []).map((q: any) => ({ id: q.id, question: q.question, options: q.options?.map((o: any) => o.label) }));
            const r = await c.permission({ titre: 'Codex demande une précision', detail: '', questions });
            envoyer({ id: m.id, result: { answers: Object.fromEntries(questions.map((q: any) => [q.id, { answers: [r.reponses?.[q.id] || 'Réponse refusée par l’utilisateur'] }])) } });
        } else {
            // Les capacités inconnues échouent explicitement ; jamais d'approbation implicite.
            envoyer({ id: m.id, error: { code: -32601, message: `Demande non prise en charge : ${m.method}` } });
        }
    };
    lignes.on('line', (ligne) => {
        let m: any; try { m = JSON.parse(ligne); } catch { return; }
        if (m.id !== undefined && m.method) { void demande(m).catch(erreur); return; }
        if (m.id !== undefined) {
            const a = attentes.get(m.id); if (!a) return;
            clearTimeout(a.timer); attentes.delete(m.id);
            if (m.error) a.ko(new Error(m.error.message || 'Erreur Codex')); else a.ok(m.result);
            return;
        }
        const p = m.params || {};
        if (tourLance) flux.recevoir(m.method, p);
        if (m.method === 'thread/tokenUsage/updated' && p.tokenUsage?.total) {
            const u = p.tokenUsage.total;
            const total = normaliserUsage({ entree: u.inputTokens, sortie: u.outputTokens, cache: u.cachedInputTokens });
            if (!tourLance) avant = total; // historique rejoué lors de resume/fork
            else {
                const delta: typeof total = {};
                for (const cle of ['entree', 'sortie', 'cache'] as const) {
                    if (avant?.[cle] !== undefined && total[cle] !== undefined && total[cle]! >= avant[cle]!) delta[cle] = total[cle]! - avant[cle]!;
                }
                c.utilisation?.(delta);
            }
            c.session.compteursCodex = total;
        }
        if (m.method === 'turn/completed') {
            if (p.turn?.status === 'completed') { termine = true; finir(); }
            else erreur(new Error(p.turn?.error?.message || `Tour Codex : ${p.turn?.status || 'échec'}`));
        }
    });
    try {
        if (c.signal.aborted) throw new Error('Tour interrompu');
        await requete('initialize', { clientInfo: { name: 'agentopia', title: 'Agentopia', version: VERSION_AGENTOPIA }, capabilities: { experimentalApi: true } });
        envoyer({ method: 'initialized' });
        const params = { cwd: c.session.cwd, model: c.session.modele,
            approvalPolicy: c.conseil || c.session.lectureSeule ? 'never' : 'on-request', sandbox: c.conseil || c.session.lectureSeule ? 'read-only' : 'workspace-write', approvalsReviewer: 'user',
            ...(c.conseil ? { ephemeral: true, developerInstructions: 'Réponds uniquement au format demandé, à partir du contexte fourni. Ne lance aucun outil. Les actions seront validées et exécutées par Agentopia.' } : {}) };
        const copier = c.session.origine?.copieAuProchainMessage && c.session.threadId === c.session.origine.threadId;
        const r = copier
            ? await requete('thread/fork', { ...params, threadId: c.session.threadId, excludeTurns: true })
            : c.session.threadId
            ? await requete('thread/resume', { ...params, threadId: c.session.threadId })
            : await requete('thread/start', params);
        const threadId = r.thread?.id;
        if (!threadId) throw new Error('Codex ne fournit pas d’identifiant de conversation');
        c.thread(threadId);
        tourLance = true;
        await requete('turn/start', { threadId, input: [{ type: 'text', text: c.prompt }] });
        await fin;
        return flux.resultat();
    } finally {
        flux.fermer(termine);
        c.signal.removeEventListener('abort', arreter);
        for (const a of attentes.values()) clearTimeout(a.timer);
        attentes.clear(); lignes.close(); proc.stdin.end(); proc.kill();
    }
}
